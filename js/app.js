/**
 * yourJPconcept - Main Application Module (app.js)
 * Router SPA, Bảng xếp hạng, Bình chọn, Lightbox & Hiệu ứng Hoa Anh Đào
 */

(function (window) {
  'use strict';

  var appState = {
    concepts: [],
    lastReset: null,
    voteDeadline: null,
    loaded: false,
    sakuraEnabled: true,
  };

  // Toast notification
  window.showToast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove('show');
    }, 3200);
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function toDisplayUrl(url) {
    if (!url) return '';
    var m = String(url).match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000';
    var m2 = String(url).match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^"']*&)?id=([a-zA-Z0-9_-]+)/);
    if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w1000';
    return url;
  }

  // Kiểm tra bình chọn đã kết thúc chưa
  function isVotingClosed() {
    if (!appState.voteDeadline) return false;
    var d = new Date(appState.voteDeadline).getTime();
    return !isNaN(d) && Date.now() >= d;
  }

  // Định dạng ngày giờ chuẩn tiếng Việt
  function formatDateTime(isoOrStr) {
    if (!isoOrStr) return '';
    var d = new Date(isoOrStr);
    if (isNaN(d.getTime())) return '';
    var hours = String(d.getHours()).padStart(2, '0');
    var minutes = String(d.getMinutes()).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    return hours + ':' + minutes + ' ngày ' + day + '/' + month + '/' + year;
  }

  // Tính thời gian còn lại
  function getRemainingTimeText(isoOrStr) {
    if (!isoOrStr) return null;
    var target = new Date(isoOrStr).getTime();
    if (isNaN(target)) return null;
    var diff = target - Date.now();
    if (diff <= 0) return 'Đã hết hạn';

    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (days > 0) {
      return days + ' ngày ' + hours + ' giờ ' + minutes + ' phút ' + seconds + ' giây';
    }
    return hours + ' giờ ' + minutes + ' phút ' + seconds + ' giây';
  }

  // Khởi tạo Sakura Petals
  function initSakura(container) {
    if (!container) return;
    container.innerHTML = '';
    if (!appState.sakuraEnabled) return;

    for (var i = 0; i < 12; i++) {
      var left = Math.round(Math.random() * 95) + 2;
      var dur = (6.5 + Math.random() * 6.5).toFixed(1);
      var delay = (Math.random() * 8).toFixed(1);
      var size = (10 + Math.random() * 7).toFixed(0);

      var p = document.createElement('span');
      p.className = 'petal';
      p.style.left = left + '%';
      p.style.animationDuration = dur + 's';
      p.style.animationDelay = '-' + delay + 's';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      container.appendChild(p);
    }
  }

  // Lightbox Modal
  function openLightbox(imgUrl, title) {
    var modal = document.getElementById('lightbox-modal');
    var img = document.getElementById('lightbox-img');
    var titleEl = document.getElementById('lightbox-title');
    var dlBtn = document.getElementById('lightbox-download-btn');

    if (!modal || !img) return;

    var displaySrc = toDisplayUrl(imgUrl);
    img.src = displaySrc;
    img.alt = title || '';
    if (titleEl) titleEl.textContent = title || 'Xem ấn phẩm';
    if (dlBtn) {
      dlBtn.href = imgUrl;
      dlBtn.download = title ? (title.replace(/[/\\?%*:|"<>]/g, '-') + '.png') : 'image.png';
    }

    modal.classList.add('active');
  }

  function closeLightbox() {
    var modal = document.getElementById('lightbox-modal');
    if (modal) modal.classList.remove('active');
  }

  // ---------- Router & Views ----------
  function route() {
    if (!appState.loaded) return;
    var hash = location.hash || '#/';
    var parts = hash.replace(/^#\/?/, '').split('/');

    document.querySelectorAll('#site-nav a').forEach(function (a) {
      a.classList.remove('active');
    });

    var appContainer = document.getElementById('app');

    if (parts[0] === 'concept' && parts[1]) {
      renderDetail(parts[1], appContainer);
    } else if (parts[0] === 'admin') {
      var adminLink = document.querySelector('#site-nav a[href="#/admin"]');
      if (adminLink) adminLink.classList.add('active');
      window.JpAdmin.render(appContainer, appState, function () {
        window.JpStorage.saveData(appState);
      });
    } else {
      var homeLink = document.querySelector('#site-nav a[href="#/"]');
      if (homeLink) homeLink.classList.add('active');
      renderHome(appContainer);
    }

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ---------- View: Home (Bảng Xếp Hạng & Danh Sách Concept) ----------
  function renderHome(container) {
    var votedMap = window.JpStorage.getVotedMap();
    var concepts = appState.concepts || [];
    var totalVotes = concepts.reduce(function (sum, c) { return sum + (c.votes || 0); }, 0);
    var closed = isVotingClosed();

    var deadlineHtml = '';
    if (appState.voteDeadline) {
      if (closed) {
        deadlineHtml =
          '<div class="deadline-status-badge closed">' +
            '<span>🔒 Bình chọn đã kết thúc lúc: <strong>' + escapeHtml(formatDateTime(appState.voteDeadline)) + '</strong></span>' +
          '</div>';
      } else {
        deadlineHtml =
          '<div class="deadline-status-badge active">' +
            '<span>⏳ Hạn bình chọn: <strong>' + escapeHtml(formatDateTime(appState.voteDeadline)) + '</strong> (Còn: <strong id="countdown-val">' + escapeHtml(getRemainingTimeText(appState.voteDeadline)) + '</strong>)</span>' +
          '</div>';
      }
    }

    // Sắp xếp theo số lượt bình chọn giảm dần
    var sorted = concepts.slice().sort(function (a, b) {
      return (b.votes || 0) - (a.votes || 0);
    });

    var cardsHtml = sorted.length ? sorted.map(function (c, idx) {
      var hasVoted = !!votedMap[c.id];
      var percent = totalVotes > 0 ? Math.round(((c.votes || 0) / totalVotes) * 100) : 0;
      var rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';

      var btnText = closed ? '🔒 Đã đóng bình chọn' : (hasVoted ? 'Đã bình chọn ✓' : '🌸 Bình chọn');
      var btnDisabled = closed || hasVoted;

      return (
        '<article class="concept-card" data-card-id="' + c.id + '">' +
          '<div class="rank-badge ' + rankClass + '">' + (idx + 1) + '</div>' +
          '<div class="frame-outer" data-nav-detail="' + c.id + '" title="Nhấn để xem chi tiết concept">' +
            '<div class="frame-inner">' +
              '<img class="concept-img" src="' + escapeHtml(toDisplayUrl(c.imageUrl)) + '" alt="' + escapeHtml(c.name) + '" loading="lazy" onerror="this.style.background=\'var(--bg-soft)\';">' +
            '</div>' +
          '</div>' +
          '<div class="concept-card-body">' +
            '<h3 class="concept-name" data-nav-detail="' + c.id + '">' + escapeHtml(c.name) + '</h3>' +
            '<p class="concept-desc-preview">' + escapeHtml(c.description || '') + '</p>' +
            '<div class="vote-progress-wrap">' +
              '<div class="vote-meta">' +
                '<span class="vote-count-num"><strong>' + (c.votes || 0) + '</strong> lượt vote</span>' +
                '<span class="vote-percentage">' + percent + '%</span>' +
              '</div>' +
              '<div class="vote-bar-track">' +
                '<div class="vote-bar-fill" style="width:' + percent + '%;"></div>' +
              '</div>' +
            '</div>' +
            '<div class="concept-actions">' +
              '<button type="button" class="btn btn-vote" data-vote-btn="' + c.id + '" ' + (btnDisabled ? 'disabled' : '') + '>' +
                btnText +
              '</button>' +
              '<button type="button" class="btn btn-outline" data-nav-detail="' + c.id + '" style="padding:10px 14px;" title="Xem chi tiết & ấn phẩm">Chi tiết</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('') : (
      '<div class="empty-state">' +
        '<h3>Chưa có concept nào</h3>' +
        '<p>Vào trang Admin để tạo concept đầu tiên.</p>' +
      '</div>'
    );

    container.innerHTML =
      '<section class="hero">' +
        '<div class="sakura-container" id="sakura-bg"></div>' +
        '<div class="hero-inner">' +
          '<div class="tanzaku"></div>' +
          '<div class="hero-text">' +
            '<h1>Concept nào xứng đáng lên sân khấu tiếp theo?</h1>' +
            '<p>Khám phá trọn bộ 4 concept độc đáo (Avatar, Ảnh bìa, Standee, Vé sự kiện, Card và Bảng màu). Bình chọn cho phong cách bạn yêu thích nhất để cùng định hình sự kiện sắp tới!</p>' +
            '<div class="hero-stats-badge">' +
              '<span>' + (closed ? '🔒 Đã kết thúc bình chọn' : '🌸 Đang mở bình chọn') + '</span>' +
              '<span>•</span>' +
              '<span>Tổng cộng: <strong>' + totalVotes + '</strong> lượt vote</span>' +
            '</div>' +
            (deadlineHtml ? '<div style="margin-top:4px;">' + deadlineHtml + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</section>' +

      '<div class="section-head">' +
        '<div class="section-head-title">' +
          '<div class="bar"></div>' +
          '<div>' +
            '<h2>Bảng Xếp Hạng Concept</h2>' +
            '<p>Thứ hạng cập nhật theo thời gian thực từ bình chọn của người hâm mộ</p>' +
          '</div>' +
        '</div>' +
        '<div class="section-head-badge">' +
          'Tổng <strong>' + concepts.length + '</strong> Concept' +
        '</div>' +
      '</div>' +

      '<main class="main-container">' +
        '<div class="concept-grid">' + cardsHtml + '</div>' +
      '</main>';

    initSakura(document.getElementById('sakura-bg'));

    // Countdown live update
    if (appState._countdownTimer) clearInterval(appState._countdownTimer);
    if (appState.voteDeadline && !closed) {
      appState._countdownTimer = setInterval(function () {
        var el = document.getElementById('countdown-val');
        if (!el) {
          clearInterval(appState._countdownTimer);
          return;
        }
        if (isVotingClosed()) {
          clearInterval(appState._countdownTimer);
          renderHome(container);
          return;
        }
        el.textContent = getRemainingTimeText(appState.voteDeadline);
      }, 1000);
    }

    // Gắn sự kiện chuyển trang chi tiết
    container.querySelectorAll('[data-nav-detail]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        location.hash = '#/concept/' + this.getAttribute('data-nav-detail');
      });
    });

    // Gắn sự kiện Vote
    container.querySelectorAll('[data-vote-btn]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cid = this.getAttribute('data-vote-btn');
        handleVote(cid, function () {
          renderHome(container);
        });
      });
    });
  }

  // ---------- View: Detail (Chi Tiết Concept & Danh Sách Ấn Phẩm) ----------
  function renderDetail(id, container) {
    var c = appState.concepts.find(function (x) { return x.id === id; });
    var votedMap = window.JpStorage.getVotedMap();

    if (!c) {
      container.innerHTML =
        '<main class="main-container">' +
          '<a class="detail-back" href="#/">‹ Quay lại trang chủ</a>' +
          '<div class="empty-state">' +
            '<h3>Không tìm thấy concept</h3>' +
            '<p>Concept này có thể đã bị gỡ hoặc đường link không chính xác.</p>' +
          '</div>' +
        '</main>';
      return;
    }

    var hasVoted = !!votedMap[c.id];
    var closed = isVotingClosed();
    var assets = c.assets || [];

    var detailBtnText = closed ? '🔒 Bình chọn đã kết thúc' : (hasVoted ? 'Đã bình chọn ✓' : '🌸 Bình chọn cho Concept này');
    var detailBtnDisabled = closed || hasVoted;

    var justificationHtml = c.justification ? (
      '<div class="justification-section">' +
        '<h2>💡 Vì sao concept này được đề xuất?</h2>' +
        '<p>' + escapeHtml(c.justification) + '</p>' +
      '</div>'
    ) : '';

    var assetsHtml = '';
    if (assets.length) {
      assetsHtml =
        '<div class="assets-section">' +
          '<h2>📦 Ấn phẩm thiết kế đi kèm (' + assets.length + ')</h2>' +
          '<p class="assets-sub">Nhấp vào từng ảnh để phóng to xem chất lượng cao hoặc tải về máy.</p>' +
          '<div class="asset-grid">' +
            assets.map(function (a) {
              return (
                '<div class="asset-card">' +
                  '<div class="asset-thumb-wrap" data-lightbox-src="' + escapeHtml(a.fileUrl) + '" data-lightbox-title="' + escapeHtml(a.title) + '">' +
                    '<img class="asset-thumb" src="' + escapeHtml(toDisplayUrl(a.fileUrl)) + '" alt="' + escapeHtml(a.title) + '" loading="lazy" onerror="this.style.background=\'var(--bg-soft)\';">' +
                    '<div class="asset-thumb-overlay">🔍 Xem to</div>' +
                  '</div>' +
                  '<div class="asset-title">' + escapeHtml(a.title) + '</div>' +
                  '<div class="asset-actions">' +
                    '<button type="button" class="btn-asset-view" data-lightbox-src="' + escapeHtml(a.fileUrl) + '" data-lightbox-title="' + escapeHtml(a.title) + '">Xem to</button>' +
                    '<a class="btn-download" href="' + escapeHtml(a.fileUrl) + '" download="' + escapeHtml(a.title) + '" target="_blank" rel="noopener">Tải về</a>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
        '</div>';
    }

    container.innerHTML =
      '<main class="main-container">' +
        '<div class="detail-header-nav">' +
          '<a class="detail-back" href="#/">‹ Quay lại bảng xếp hạng</a>' +
        '</div>' +
        '<div class="detail-layout">' +
          '<div class="frame-outer detail-img-frame" data-lightbox-src="' + escapeHtml(c.imageUrl) + '" data-lightbox-title="' + escapeHtml(c.name) + '" title="Nhấn để phóng to ảnh đại diện">' +
            '<div class="frame-inner">' +
              '<img src="' + escapeHtml(toDisplayUrl(c.imageUrl)) + '" alt="' + escapeHtml(c.name) + '">' +
            '</div>' +
          '</div>' +
          '<div class="detail-info">' +
            '<h1 class="detail-name">' + escapeHtml(c.name) + '</h1>' +
            '<div class="detail-vote-row">' +
              '<button type="button" class="btn btn-vote" data-detail-vote="' + c.id + '" ' + (detailBtnDisabled ? 'disabled' : '') + '>' +
                detailBtnText +
              '</button>' +
              '<div class="detail-vote-count-box">' +
                '<span class="detail-vote-count-num">' + (c.votes || 0) + '</span>' +
                '<span style="font-size:0.82rem; color:var(--ink-soft);">lượt bình chọn</span>' +
              '</div>' +
            '</div>' +
            (closed ? '<div style="margin-top:8px; font-size:0.88rem; color:var(--vermillion);">🔒 Thời gian bình chọn đã kết thúc lúc ' + escapeHtml(formatDateTime(appState.voteDeadline)) + '.</div>' : '') +
            '<div class="divider"></div>' +
            '<div class="detail-desc-title">Mô tả Concept:</div>' +
            '<p class="detail-desc">' + escapeHtml(c.description || '') + '</p>' +
            justificationHtml +
          '</div>' +
        '</div>' +
        assetsHtml +
      '</main>';

    // Sự kiện Vote ở trang chi tiết
    var voteBtn = container.querySelector('[data-detail-vote]');
    if (voteBtn && !detailBtnDisabled) {
      voteBtn.addEventListener('click', function () {
        handleVote(c.id, function () {
          renderDetail(id, container);
        });
      });
    }

    // Sự kiện mở Lightbox
    container.querySelectorAll('[data-lightbox-src]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var src = this.getAttribute('data-lightbox-src');
        var title = this.getAttribute('data-lightbox-title');
        openLightbox(src, title);
      });
    });
  }

  // ---------- Xử lý Bình chọn (Vote Logic) ----------
  async function handleVote(conceptId, onComplete) {
    if (isVotingClosed()) {
      window.showToast('🔒 Bình chọn đã kết thúc lúc ' + formatDateTime(appState.voteDeadline) + '!');
      return;
    }

    var votedMap = window.JpStorage.getVotedMap();
    if (votedMap[conceptId]) {
      window.showToast('Bạn đã bình chọn cho concept này rồi!');
      return;
    }

    var target = appState.concepts.find(function (c) { return c.id === conceptId; });
    if (!target) return;

    // Optimistic Update
    target.votes = (target.votes || 0) + 1;
    window.JpStorage.setVoted(conceptId);
    window.showToast('🌸 Cảm ơn bạn! Đã ghi nhận bình chọn cho "' + target.name + '"!');
    if (onComplete) onComplete();

    // Mã hóa & Lưu trữ + Commit lên GitHub
    await window.JpStorage.saveData(appState, 'Vote for concept "' + target.name + '" [skip ci]');
  }

  // ---------- Khởi chạy Ứng Dụng (Init) ----------
  async function init() {
    // 1. Khởi tạo Admin State
    window.JpAdmin.init();

    // 2. Tải Dữ liệu từ GitHub / File data.json / Cache Local
    var loadedData = await window.JpStorage.loadData();
    appState.concepts = (loadedData && loadedData.concepts) ? loadedData.concepts : [];
    appState.lastReset = loadedData ? loadedData.lastReset : null;
    appState.voteDeadline = loadedData ? loadedData.voteDeadline : null;
    appState.loaded = true;

    // 4. Thiết lập công tắc hoa anh đào
    var petalBtn = document.getElementById('petal-toggle-btn');
    if (petalBtn) {
      petalBtn.addEventListener('click', function () {
        appState.sakuraEnabled = !appState.sakuraEnabled;
        this.innerHTML = appState.sakuraEnabled ? '🌸 Hoa rơi: Bật' : '🌸 Hoa rơi: Tắt';
        var sakuraBg = document.getElementById('sakura-bg');
        if (sakuraBg) initSakura(sakuraBg);
      });
    }

    // 5. Thiết lập sự kiện Lightbox Modal
    var modal = document.getElementById('lightbox-modal');
    var closeBtn = document.getElementById('lightbox-close-btn');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeLightbox();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeLightbox);
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });

    // 6. Router SPA
    window.addEventListener('hashchange', route);
    route();
  }

  // Khởi động khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
