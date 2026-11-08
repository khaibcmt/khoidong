// --- QUẢN LÝ XOAY VÒNG API KEY ---
let geminiKeys = [];
let currentKeyIndex = 0;

const apiKeysInput = document.getElementById('apiKeys');
const keyCountLabel = document.getElementById('keyCountLabel');

// Tải key đã lưu từ bộ nhớ trình duyệt
const savedKeys = localStorage.getItem('vietstudio_gemini_keys') || '';
if (savedKeys) {
  apiKeysInput.value = savedKeys;
  updateKeyList();
}

apiKeysInput.addEventListener('input', () => {
  localStorage.setItem('vietstudio_gemini_keys', apiKeysInput.value.trim());
  updateKeyList();
});

function updateKeyList() {
  geminiKeys = apiKeysInput.value.split('\n').map(k => k.trim()).filter(k => k.length > 10);
  keyCountLabel.textContent = `Số key sẵn sàng: ${geminiKeys.length}`;
}

function getNextApiKey() {
  if (geminiKeys.length === 0) return null;
  const key = geminiKeys[currentKeyIndex % geminiKeys.length];
  currentKeyIndex++;
  return key;
}

// --- CHUẨN HÓA SỐ TIẾNG VIỆT SANG CHỮ ---
const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function read3DigitsVi(n, forceHundred) {
  const h = Math.floor(n / 100), r = n % 100, t = Math.floor(r / 10), u = r % 10;
  const p = [];
  if (h > 0 || forceHundred) p.push(`${VI_DIGITS[h]} trăm`);
  if (t === 0 && u === 0) return p.join(' ');
  if (t === 0) { p.push(h > 0 || forceHundred ? `lẻ ${VI_DIGITS[u]}` : VI_DIGITS[u]); return p.join(' '); }
  if (t === 1) { p.push('mười'); if (u === 5) p.push('lăm'); else if (u > 0) p.push(VI_DIGITS[u]); return p.join(' '); }
  p.push(`${VI_DIGITS[t]} mươi`);
  if (u === 1) p.push('mốt'); else if (u === 5) p.push('lăm'); else if (u > 0) p.push(VI_DIGITS[u]);
  return p.join(' ');
}
function numberToVietnameseWords(num) {
  const n = Math.floor(Number(num));
  if (!Number.isFinite(n) || n < 0) return String(num);
  if (n === 0) return 'không';
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  let temp = n, idx = 0, res = [];
  while (temp > 0) {
    const chunk = temp % 1000;
    if (chunk > 0) {
      const s = read3DigitsVi(chunk, temp >= 1000);
      res.unshift(units[idx] ? `${s} ${units[idx]}` : s);
    }
    temp = Math.floor(temp / 1000);
    idx++;
  }
  return res.join(' ').trim();
}
function normalizeViSpeech(text) {
  if (!text) return '';
  let str = String(text);
  str = str.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, m => numberToVietnameseWords(Number(m.replace(/\./g, ''))));
  str = str.replace(/\b(\d+)\b/g, m => numberToVietnameseWords(Number(m)));
  return str.replace(/\bkm\b/gi, 'ki-lô-mét').replace(/%/g, ' phần trăm').trim();
}

// --- ENGINE ĐẠO DIỄN GEMINI AUTO-DIRECTOR ---
let scenes = [];
const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');
const statusLabel = document.getElementById('statusLabel');

function renderPlaceholder(msg = "SẴN SÀNG TẠO VIDEO MỚI") {
  ctx.fillStyle = "#030712";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f59e0b";
  ctx.font = "bold 34px 'Montserrat', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = "#64748b";
  ctx.font = "18px 'Inter', sans-serif";
  ctx.fillText("Nhập tên bài học và bấm 'Tự Động Biên Soạn & Dựng Video'", canvas.width / 2, canvas.height / 2 + 45);
}
renderPlaceholder();

document.getElementById('btnAutoGenerate').addEventListener('click', async () => {
  const topic = document.getElementById('topicInput').value.trim();
  const subject = document.getElementById('subjectSelect').value;
  const duration = document.getElementById('durationSelect').value;
  const rawScript = document.getElementById('customScript').value.trim();

  if (geminiKeys.length === 0) {
    alert("Thầy vui lòng nhập ít nhất 1 Gemini API Key vào ô phía trên!");
    return;
  }
  if (!topic && !rawScript) {
    alert("Thầy vui lòng nhập Tên bài học hoặc Dán kịch bản!");
    return;
  }

  statusLabel.textContent = "Đang gọi Gemini biên soạn kịch bản và chuẩn hóa từ khóa...";
  const targetScenes = duration == 1 ? 3 : (duration == 2 ? 5 : 7);

  const promptText = `Bạn là đạo diễn phim tài liệu giáo dục Việt Nam.
Hãy xây dựng kịch bản video bài học: "${topic || 'Chủ đề tùy chỉnh'}", môn ${subject}.
Thời lượng: ${duration} phút, chia chính xác thành ${targetScenes} phân cảnh.
Nội dung có thể dựa trên: ${rawScript || 'tự xây dựng theo chuẩn sư phạm'}.

Yêu cầu định dạng JSON DUY NHẤT:
[
  {
    "scene_id": 1,
    "narration_vi": "Lời bình tiếng Việt truyền cảm, tự nhiên",
    "exact_entity_en": "Chủ thể cụ thể nhất bằng tiếng Anh để tìm video/ảnh (ví dụ: Pangasius catfish underwater swimming, paddlewheel aerator shrimp farm, classroom students)",
    "motion": "zoom-in"
  }
]`;

  let responseJson = null;
  for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
    const activeKey = getNextApiKey();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const jsonStr = data.candidates[0].content.parts[0].text;
        responseJson = JSON.parse(jsonStr);
        break;
      }
    } catch (err) {
      console.warn("Thử đổi sang key kế tiếp...", err);
    }
  }

  if (!responseJson) {
    statusLabel.textContent = "Lỗi kết nối Gemini API. Vui lòng kiểm tra lại Key!";
    return;
  }

  // Xử lý danh sách phân cảnh
  scenes = responseJson.map((sc, i) => {
    const norm = normalizeViSpeech(sc.narration_vi);
    const words = norm.split(/\s+/).filter(Boolean).length;
    const durSec = Math.max(5, Math.round(words / 3.2 + 1));
    const entity = sc.exact_entity_en || "educational laboratory 4k";
    
    // Nguồn ảnh động 16:9 độ nét cao
    const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(entity + ", documentary style, photorealistic, 4k, 16:9, highly detailed, no text")}?width=1280&height=720&nologo=true`;

    return {
      id: i + 1,
      narration: sc.narration_vi,
      narration_norm: norm,
      entity: entity,
      motion: sc.motion || "zoom-in",
      duration: durSec,
      imgUrl: imgUrl,
      imgElement: null
    };
  });

  // Hiển thị ra giao diện
  const listEl = document.getElementById('scenesList');
  listEl.innerHTML = '';
  document.getElementById('sceneNum').textContent = scenes.length;

  let loadedCount = 0;
  statusLabel.textContent = `Đang tải ${scenes.length} khung hình tư liệu...`;

  scenes.forEach(sc => {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.innerHTML = `
      <img class="scene-thumb" src="${sc.imgUrl}" alt="thumb-${sc.id}"/>
      <div class="scene-detail">
        <strong>Cảnh ${sc.id} (~${sc.duration}s): ${sc.entity}</strong>
        <div>${sc.narration.substring(0, 75)}...</div>
      </div>
    `;
    listEl.appendChild(card);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = sc.imgUrl;
    img.onload = () => {
      sc.imgElement = img;
      loadedCount++;
      if (loadedCount === scenes.length) {
        statusLabel.textContent = "Đã dựng xong phân cảnh! Bấm Phát hoặc Xuất Video.";
        document.getElementById('btnPlay').disabled = false;
        document.getElementById('btnExport').disabled = false;
        drawFrame(scenes[0], 0);
      }
    };
  });
});

// --- RENDER CANVAS VỚI HIỆU ỨNG KEN BURNS & PHỤ ĐỀ ---
function drawFrame(scene, progress) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (scene.imgElement) {
    const scale = scene.motion === "zoom-out" ? (1.15 - progress * 0.15) : (1.0 + progress * 0.15);
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.drawImage(scene.imgElement, x, y, w, h);
  }

  // Đổ bóng nền phụ đề
  const grad = ctx.createLinearGradient(0, canvas.height - 130, 0, canvas.height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, canvas.height - 130, canvas.width, 130);

  // Vẽ phụ đề tiếng Việt
  if (scene.narration) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 8;
    ctx.fillText(scene.narration, canvas.width / 2, canvas.height - 35, canvas.width - 120);
    ctx.shadowBlur = 0;
  }
}

// --- PHÁT GIỌNG ĐỌC TIẾNG VIỆT & TRÌNH DIỄN ---
let isPlaying = false;

function speakVi(text) {
  return new Promise((resolve) => {
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=gtx`;
    const audio = new Audio(url);
    audio.referrerPolicy = "no-referrer";
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

async function startPlayback() {
  if (isPlaying || scenes.length === 0) return;
  isPlaying = true;
  document.getElementById('btnPlay').textContent = "⏹️ Đang Phát Video...";

  for (let i = 0; i < scenes.length; i++) {
    if (!isPlaying) break;
    const sc = scenes[i];
    statusLabel.textContent = `Đang phát Cảnh ${sc.id} / ${scenes.length}`;

    const startTime = performance.now();
    const durationMs = sc.duration * 1000;

    speakVi(sc.narration_norm);

    while (performance.now() - startTime < durationMs) {
      if (!isPlaying) break;
      const progress = Math.min(1, (performance.now() - startTime) / durationMs);
      drawFrame(sc, progress);
      await new Promise(r => requestAnimationFrame(r));
    }
  }

  isPlaying = false;
  document.getElementById('btnPlay').textContent = "▶️ Phát Video & Giọng Đọc";
  statusLabel.textContent = "Hoàn thành trình chiếu!";
}

document.getElementById('btnPlay').addEventListener('click', () => {
  if (isPlaying) {
    isPlaying = false;
    document.getElementById('btnPlay').textContent = "▶️ Phát Video & Giọng Đọc";
  } else {
    startPlayback();
  }
});

// --- XUẤT VIDEO .WEBM ---
document.getElementById('btnExport').addEventListener('click', () => {
  if (scenes.length === 0) return;

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
  const chunks = [];

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video_bai_giang_${Date.now()}.webm`;
    a.click();
    statusLabel.textContent = "Đã xuất video .webm thành công!";
  };

  recorder.start();
  statusLabel.textContent = "Đang ghi hình video để xuất file...";
  startPlayback().then(() => {
    if (recorder.state === "recording") recorder.stop();
  });
});

// --- NÚT RESET TẠO MỚI ---
document.getElementById('btnResetAll').addEventListener('click', () => {
  isPlaying = false;
  scenes = [];
  document.getElementById('topicInput').value = '';
  document.getElementById('customScript').value = '';
  document.getElementById('scenesList').innerHTML = '<p class="empty-state">Chưa có phân cảnh nào. Vui lòng nhập tên bài hoặc dán kịch bản để bắt đầu.</p>';
  document.getElementById('sceneNum').textContent = '0';
  document.getElementById('btnPlay').disabled = true;
  document.getElementById('btnExport').disabled = true;
  statusLabel.textContent = "Trạng thái: Sẵn sàng";
  renderPlaceholder("SẴN SÀNG TẠO VIDEO MỚI");
});
