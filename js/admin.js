/**
 * yourJPconcept - Admin Module (admin.js)
 * Toàn bộ logic Quản trị: Thêm/Sửa/Xóa concept, Upload file ảnh từ máy, Quản lý ấn phẩm, Reset vote & Cấu hình GitHub Sync.
 * BẢO MẬT: Không chứa bất kỳ mật khẩu hay hash mặc định nào trong mã nguồn Git repo.
 */

(function (window) {
  'use strict';

  var ADMIN_SESSION_KEY = 'yjp_admin_authenticated';
  var ADMIN_HASH_KEY = 'yjp_admin_pass_hash';
  var HASH_SALT = 'jpc_admin_secure_salt_2026';

  // Hàm băm mật khẩu một chiều SHA-256 chuẩn Web Crypto API
  async function hashPassword(plainPass) {
    var enc = new TextEncoder();
    var data = enc.encode((plainPass || '') + ':' + HASH_SALT);
    if (window.crypto && window.crypto.subtle) {
      try {
        var buffer = await window.crypto.subtle.digest('SHA-256', data);
        var bytes = new Uint8Array(buffer);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return hex;
      } catch (e) {}
    }
    var h = 0x811c9dc5;
    for (var j = 0; j < data.length; j++) {
      h ^= data[j];
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return 'fb_' + (h >>> 0).toString(16);
  }

  // Lấy hash mật khẩu lưu trong localStorage của trình duyệt (Không nằm trong code Git)
  function getStoredPasswordHash() {
    try {
      return localStorage.getItem(ADMIN_HASH_KEY);
    } catch (e) {
      return null;
    }
  }

  function setAdminPasswordHash(hashed) {
    try {
      if (hashed) {
        localStorage.setItem(ADMIN_HASH_KEY, hashed);
      } else {
        localStorage.removeItem(ADMIN_HASH_KEY);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  var adminState = {
    isAuthenticated: false,
    expandedEditId: null,
    expandedAssetsId: null,
    pendingNewAssets: [],
    testResult: null,
  };

  // Kiểm tra phiên đăng nhập
  function checkAuth() {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setAuth(auth) {
    adminState.isAuthenticated = auth;
    try {
      if (auth) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      } else {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
      }
    } catch (e) {}
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // Chuyển đổi link Google Drive nếu có
  function toDisplayUrl(url) {
    if (!url) return '';
    var m = String(url).match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000';
    var m2 = String(url).match(/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^"']*&)?id=([a-zA-Z0-9_-]+)/);
    if (m2) return 'https://drive.google.com/thumbnail?id=' + m2[1] + '&sz=w1000';
    return url;
  }

  // Đọc file ảnh từ máy tính sang Data URL (Base64)
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve(null);
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function (e) { reject(e); };
      reader.readAsDataURL(file);
    });
  }

  var JpAdmin = {
    init: function () {
      adminState.isAuthenticated = checkAuth();
    },

    render: function (appContainer, appState, onDataChange) {
      if (!adminState.isAuthenticated) {
        var storedHash = getStoredPasswordHash();
        if (!storedHash) {
          this.renderFirstTimeSetup(appContainer, appState, onDataChange);
        } else {
          this.renderLogin(appContainer, appState, onDataChange);
        }
      } else {
        this.renderDashboard(appContainer, appState, onDataChange);
      }
    },

    // Màn hình 1: Thiết lập hoặc Đăng nhập bằng Token
    renderFirstTimeSetup: function (container, appState, onDataChange) {
      var self = this;
      container.innerHTML =
        '<div class="admin-wrap" style="max-width:500px;">' +
          '<h2>🔐 Đăng Nhập Quản Trị Admin</h2>' +
          '<p style="font-size:0.88rem; color:var(--ink-soft); margin-bottom:18px; line-height:1.5;">' +
            'Bạn hoặc người được cấp quyền có thể đăng nhập bằng <strong>GitHub Access Token</strong> để tự động kết nối & đồng bộ dữ liệu, hoặc tự đặt mật khẩu riêng trên máy này:' +
          '</p>' +

          '<div class="field">' +
            '<label for="token-login-inp">🔑 Cách 1: Đăng nhập bằng GitHub Access Token (Khuyên dùng)</label>' +
            '<input type="password" id="token-login-inp" placeholder="Dán mã ghp_... hoặc github_pat_..." autocomplete="off">' +
            '<div class="field-hint">Chỉ cần dán Token GitHub là tự động xác thực và kích hoạt đồng bộ đám mây.</div>' +
          '</div>' +
          '<div class="form-error" id="token-login-error"></div>' +
          '<button class="btn btn-secondary" id="token-login-btn" style="width:100%; margin-bottom:24px;">Đăng nhập bằng GitHub Token</button>' +

          '<div style="text-align:center; position:relative; margin:16px 0; border-top:1px dashed var(--line);">' +
            '<span style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); background:var(--panel); padding:0 12px; font-size:0.8rem; color:var(--ink-soft);">HOẶC</span>' +
          '</div>' +

          '<div class="field">' +
            '<label for="setup-pass">🛡️ Cách 2: Tự đặt mật khẩu quản trị riêng trên máy này</label>' +
            '<input type="password" id="setup-pass" placeholder="Nhập mật khẩu bạn muốn đặt..." autocomplete="off">' +
          '</div>' +
          '<div class="field">' +
            '<label for="setup-pass-confirm">Xác nhận lại mật khẩu</label>' +
            '<input type="password" id="setup-pass-confirm" placeholder="Nhập lại mật khẩu..." autocomplete="off">' +
          '</div>' +
          '<div class="form-error" id="setup-error"></div>' +
          '<button class="btn btn-outline" id="setup-submit-btn" style="width:100%; padding:10px;">Lưu mật khẩu & Đăng nhập</button>' +
        '</div>';

      // Xử lý đăng nhập bằng GitHub Token
      async function attemptTokenLogin() {
        var token = document.getElementById('token-login-inp').value.trim();
        var errEl = document.getElementById('token-login-error');
        var btn = document.getElementById('token-login-btn');

        if (!token) {
          errEl.textContent = 'Vui lòng nhập GitHub Access Token.';
          return;
        }

        errEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'Đang kiểm tra quyền với GitHub...';

        var testRes = await window.JpStorage.testConnection({ token: token });
        if (testRes.success) {
          window.JpStorage.saveConfig({ token: token, autoSync: true });
          setAuth(true);
          window.showToast('✅ Đăng nhập bằng GitHub Token thành công!');
          self.renderDashboard(container, appState, onDataChange);
        } else {
          errEl.textContent = 'Lỗi xác thực Token: ' + testRes.message;
          btn.disabled = false;
          btn.textContent = 'Đăng nhập bằng GitHub Token';
        }
      }

      document.getElementById('token-login-btn').addEventListener('click', attemptTokenLogin);
      document.getElementById('token-login-inp').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') attemptTokenLogin();
      });

      // Xử lý tạo mật khẩu riêng
      async function attemptSetup() {
        var p1 = document.getElementById('setup-pass').value.trim();
        var p2 = document.getElementById('setup-pass-confirm').value.trim();
        var errEl = document.getElementById('setup-error');

        if (!p1) {
          errEl.textContent = 'Vui lòng nhập mật khẩu muốn đặt.';
          return;
        }
        if (p1.length < 4) {
          errEl.textContent = 'Mật khẩu phải có ít nhất 4 ký tự.';
          return;
        }
        if (p1 !== p2) {
          errEl.textContent = 'Mật khẩu xác nhận không khớp.';
          return;
        }

        var hashed = await hashPassword(p1);
        setAdminPasswordHash(hashed);
        setAuth(true);
        window.showToast('🎉 Đã thiết lập mật khẩu quản trị thành công!');
        self.renderDashboard(container, appState, onDataChange);
      }

      document.getElementById('setup-submit-btn').addEventListener('click', attemptSetup);
      document.getElementById('setup-pass-confirm').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') attemptSetup();
      });
    },

    // Màn hình 2: Đăng nhập Admin (Khi đã có mật khẩu hoặc token)
    renderLogin: function (container, appState, onDataChange) {
      var self = this;
      container.innerHTML =
        '<div class="admin-wrap">' +
          '<h2>🔐 Đăng nhập Quản trị</h2>' +
          '<div class="field">' +
            '<label for="admin-pass">Mật khẩu hoặc GitHub Access Token</label>' +
            '<input type="password" id="admin-pass" placeholder="Nhập mật khẩu hoặc dán Token..." autocomplete="off">' +
          '</div>' +
          '<div class="form-error" id="admin-login-error"></div>' +
          '<button class="btn btn-primary" id="admin-login-btn" style="width:100%; margin-bottom:12px;">Đăng nhập</button>' +
          '<button type="button" class="btn-text" id="reset-admin-local-btn" style="width:100%; text-align:center; font-size:0.8rem; color:var(--ink-soft);">' +
            'Đổi cách đăng nhập / Thiết lập lại trên thiết bị này' +
          '</button>' +
        '</div>';

      async function attemptLogin() {
        var val = document.getElementById('admin-pass').value.trim();
        var errEl = document.getElementById('admin-login-error');
        var btn = document.getElementById('admin-login-btn');

        if (!val) {
          errEl.textContent = 'Vui lòng nhập mật khẩu hoặc Token.';
          return;
        }

        // 1. Kiểm tra xem có phải GitHub Token (ghp_ hoặc github_pat_)
        if (val.startsWith('ghp_') || val.startsWith('github_pat_')) {
          btn.disabled = true;
          btn.textContent = 'Đang kiểm tra Token...';
          var testRes = await window.JpStorage.testConnection({ token: val });
          if (testRes.success) {
            window.JpStorage.saveConfig({ token: val, autoSync: true });
            setAuth(true);
            window.showToast('✅ Đăng nhập bằng GitHub Token thành công!');
            self.renderDashboard(container, appState, onDataChange);
            return;
          }
          btn.disabled = false;
          btn.textContent = 'Đăng nhập';
        }

        // 2. Kiểm tra mật khẩu local
        var inputHash = await hashPassword(val);
        var storedHash = getStoredPasswordHash();

        if (inputHash === storedHash) {
          setAuth(true);
          self.renderDashboard(container, appState, onDataChange);
        } else {
          errEl.textContent = 'Mật khẩu hoặc Token không đúng. Vui lòng kiểm tra lại.';
        }
      }

      document.getElementById('admin-login-btn').addEventListener('click', attemptLogin);
      document.getElementById('admin-pass').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') attemptLogin();
      });

      document.getElementById('reset-admin-local-btn').addEventListener('click', function () {
        setAdminPasswordHash(null);
        self.renderFirstTimeSetup(container, appState, onDataChange);
      });

      document.getElementById('admin-pass').focus();
    },

    // Màn hình 3: Dashboard Quản trị
    renderDashboard: function (container, appState, onDataChange) {
      var self = this;
      var concepts = appState.concepts || [];
      var totalVotes = concepts.reduce(function (sum, c) { return sum + (c.votes || 0); }, 0);
      var ghConfig = window.JpStorage.getConfig();
      var syncState = window.JpStorage.getSyncState();

      // Sắp xếp concept theo lượt vote
      var sorted = concepts.slice().sort(function (a, b) {
        return (b.votes || 0) - (a.votes || 0);
      });

      // Render danh sách concept
      var conceptRowsHtml = sorted.length ? sorted.map(function (c) {
        var assets = c.assets || [];
        var isEditing = adminState.expandedEditId === c.id;
        var isAssetsOpen = adminState.expandedAssetsId === c.id;

        // Khung chỉnh sửa thông tin Concept
        var editPanelHtml = '';
        if (isEditing) {
          editPanelHtml =
            '<div class="concept-edit-panel">' +
              '<div class="field">' +
                '<label>Tên concept</label>' +
                '<input type="text" id="edit-name-' + c.id + '" value="' + escapeHtml(c.name) + '">' +
              '</div>' +
              '<div class="field">' +
                '<label>Ảnh đại diện (Nhập link hoặc tải ảnh từ máy tính)</label>' +
                '<div class="input-file-group">' +
                  '<input type="text" id="edit-img-' + c.id + '" value="' + escapeHtml(c.imageUrl) + '" placeholder="Đường dẫn ảnh hoặc URL...">' +
                  '<label class="btn-upload-file">' +
                    '📁 Đổi file ảnh' +
                    '<input type="file" id="edit-img-file-' + c.id + '" accept="image/*">' +
                  '</label>' +
                '</div>' +
                '<div class="img-preview-box" id="edit-preview-box-' + c.id + '">' +
                  '<img src="' + escapeHtml(toDisplayUrl(c.imageUrl)) + '" class="img-preview-thumb" id="edit-preview-thumb-' + c.id + '" onerror="this.src=\'\';">' +
                  '<span class="img-preview-name" id="edit-preview-name-' + c.id + '">Ảnh đại diện hiện tại</span>' +
                '</div>' +
              '</div>' +
              '<div class="field">' +
                '<label>Mô tả concept</label>' +
                '<textarea id="edit-desc-' + c.id + '">' + escapeHtml(c.description) + '</textarea>' +
              '</div>' +
              '<div class="field">' +
                '<label>Lý do đề xuất (hiển thị công khai, tùy chọn)</label>' +
                '<textarea id="edit-justify-' + c.id + '">' + escapeHtml(c.justification || '') + '</textarea>' +
              '</div>' +
              '<div class="form-error" id="edit-error-' + c.id + '"></div>' +
              '<div class="concept-edit-actions">' +
                '<button type="button" class="btn btn-primary" data-save-edit="' + c.id + '">Lưu thay đổi</button>' +
                '<button type="button" class="btn btn-outline" data-cancel-edit="' + c.id + '">Hủy</button>' +
              '</div>' +
            '</div>';
        }

        // Khung quản lý Ấn phẩm đi kèm
        var assetsPanelHtml = '';
        if (isAssetsOpen) {
          var existingAssetsHtml = assets.length ? assets.map(function (a) {
            return (
              '<div class="asset-row-edit" style="grid-template-columns: 1.2fr 2fr auto auto; gap:8px;">' +
                '<input type="text" data-asset-title="' + c.id + '|' + a.id + '" value="' + escapeHtml(a.title) + '" placeholder="Tên ấn phẩm (VD: Standee, Vé...)">' +
                '<input type="text" data-asset-link="' + c.id + '|' + a.id + '" value="' + escapeHtml(a.fileUrl) + '" placeholder="Link ảnh hoặc file...">' +
                '<label class="btn-upload-file" style="padding:6px 10px; font-size:0.78rem;">' +
                  '📁 Up ảnh' +
                  '<input type="file" accept="image/*" data-asset-file="' + c.id + '|' + a.id + '">' +
                '</label>' +
                '<button type="button" class="btn-text" data-asset-del="' + c.id + '|' + a.id + '">Xóa</button>' +
              '</div>'
            );
          }).join('') : '<p class="asset-hint">Chưa có ấn phẩm đi kèm nào cho concept này.</p>';

          assetsPanelHtml =
            '<div class="assets-manage">' +
              '<h4 style="font-size:0.95rem; margin-bottom:10px; color:var(--indigo);">Quản lý ấn phẩm: ' + escapeHtml(c.name) + '</h4>' +
              existingAssetsHtml +
              '<div class="asset-row-edit" style="margin-top:12px; border-top:1px dashed var(--line); padding-top:10px; grid-template-columns: 1.2fr 2fr auto auto; gap:8px;">' +
                '<input type="text" placeholder="+ Tên ấn phẩm mới (VD: Card, Vé, Cover...)" id="new-asset-title-' + c.id + '">' +
                '<input type="text" placeholder="Đường dẫn file hoặc URL..." id="new-asset-link-' + c.id + '">' +
                '<label class="btn-upload-file" style="padding:6px 10px; font-size:0.78rem;">' +
                  '📁 Up ảnh' +
                  '<input type="file" accept="image/*" id="new-asset-file-' + c.id + '">' +
                '</label>' +
                '<button type="button" class="btn btn-secondary" style="font-size:0.8rem; padding:6px 12px;" data-asset-add="' + c.id + '">+ Thêm</button>' +
              '</div>' +
            '</div>';
        }

        return (
          '<div class="concept-row-wrap">' +
            '<div class="concept-row">' +
              '<img src="' + escapeHtml(toDisplayUrl(c.imageUrl)) + '" alt="' + escapeHtml(c.name) + '" onerror="this.style.background=\'var(--bg-soft)\';">' +
              '<div class="r-meta">' +
                '<div class="r-name">' + escapeHtml(c.name) + '</div>' +
                '<div class="r-votes"><strong>' + (c.votes || 0) + '</strong> lượt bình chọn • ' + assets.length + ' ấn phẩm</div>' +
              '</div>' +
              '<div class="concept-row-actions">' +
                '<button type="button" class="btn-text" data-toggle-edit="' + c.id + '">' + (isEditing ? 'Đang sửa ▲' : 'Sửa ▼') + '</button>' +
                '<button type="button" class="btn-text" data-toggle-assets="' + c.id + '">Ấn phẩm (' + assets.length + ')' + (isAssetsOpen ? ' ▲' : ' ▼') + '</button>' +
                '<button type="button" class="btn-text" data-reset-vote="' + c.id + '" style="color:var(--vermillion);" title="Đặt lại lượt vote của concept này về 0">Reset vote</button>' +
                '<button type="button" class="btn-text" data-del-concept="' + c.id + '" style="color:var(--ink-soft);">Xóa</button>' +
              '</div>' +
            '</div>' +
            editPanelHtml +
            assetsPanelHtml +
          '</div>'
        );
      }).join('') : '<p style="color:var(--ink-soft); text-align:center; padding:30px;">Chưa có concept nào trong hệ thống.</p>';

      container.innerHTML =
        '<div class="admin-panel">' +
          '<div class="admin-topbar">' +
            '<div class="admin-topbar-title">' +
              '<h2>🛠️ Bảng Quản trị Concept</h2>' +
            '</div>' +
            '<div class="admin-stats-chips">' +
              '<span class="stat-chip">Tổng: <strong>' + concepts.length + '</strong> concept</span>' +
              '<span class="stat-chip">Tổng vote: <strong>' + totalVotes + '</strong></span>' +
              '<button class="btn btn-outline" id="admin-logout-btn" style="padding:6px 14px; font-size:0.85rem;">Đăng xuất</button>' +
            '</div>' +
          '</div>' +

          // Block 1: Danh sách Concept & Reset Toàn Bộ Vote
          '<div class="admin-block">' +
            '<div class="admin-block-header">' +
              '<h3>📋 Danh sách Concept (' + sorted.length + ')</h3>' +
              (sorted.length ? '<button type="button" class="btn btn-danger" id="reset-all-votes-btn" style="font-size:0.85rem; padding:8px 16px;">🔄 Reset toàn bộ vote</button>' : '') +
            '</div>' +
            conceptRowsHtml +
          '</div>' +

          // Block 2: Thêm Concept Mới
          '<div class="admin-block">' +
            '<h3>➕ Thêm Concept Mới</h3>' +
            '<div class="field">' +
              '<label for="f-name">Tên concept <span style="color:var(--vermillion);">*</span></label>' +
              '<input type="text" id="f-name" placeholder="VD: Concept 5 — Tinh Khôi Mùa Hạ...">' +
            '</div>' +
            '<div class="field">' +
              '<label for="f-img">Ảnh đại diện <span style="color:var(--vermillion);">*</span> (Nhập link hoặc tải ảnh từ máy tính)</label>' +
              '<div class="input-file-group">' +
                '<input type="text" id="f-img" placeholder="Đường dẫn ảnh hoặc URL...">' +
                '<label class="btn-upload-file">' +
                  '📁 Tải ảnh từ máy' +
                  '<input type="file" id="f-img-file" accept="image/*">' +
                '</label>' +
              '</div>' +
              '<div class="img-preview-box" id="f-img-preview-box" style="display:none;">' +
                '<img src="" class="img-preview-thumb" id="f-img-preview-thumb">' +
                '<span class="img-preview-name" id="f-img-preview-name"></span>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<label for="f-desc">Mô tả concept <span style="color:var(--vermillion);">*</span></label>' +
              '<textarea id="f-desc" placeholder="Giới thiệu về ý tưởng, phong cách thiết kế, trang phục, ánh sáng..."></textarea>' +
            '</div>' +
            '<div class="field">' +
              '<label for="f-justify">Lý do đề xuất (tùy chọn)</label>' +
              '<textarea id="f-justify" placeholder="Vì sao concept này phù hợp hoặc nổi bật..."></textarea>' +
            '</div>' +
            '<div class="field">' +
              '<label>Ấn phẩm đi kèm (Avatar, Cover, Standee, Vé...)</label>' +
              '<div id="pending-assets-container"></div>' +
              '<button type="button" class="btn btn-outline" id="add-pending-asset-row-btn" style="margin-top:8px; font-size:0.84rem;">+ Thêm ấn phẩm đi kèm</button>' +
            '</div>' +
            '<div class="form-error" id="add-concept-error"></div>' +
            '<button class="btn btn-primary" id="add-concept-btn" style="padding:12px 26px;">Đăng Concept</button>' +
          '</div>' +

          // Block 3: Cấu hình GitHub Sync & Bảo Mật JSON
          '<div class="admin-block github-config-card">' +
            '<div class="admin-block-header">' +
              '<h3>☁️ Đồng bộ & Bảo mật GitHub API</h3>' +
              '<span class="security-badge">🔒 File JSON đã mã hóa AES</span>' +
            '</div>' +
            '<p style="font-size:0.88rem; color:#CFBA94; margin-bottom:16px;">' +
              'Dữ liệu vote và concept được tự động mã hóa trước khi commit lên file <code>' + escapeHtml(ghConfig.path) + '</code> trên GitHub repo. ' +
              'Người xem trực tiếp repo sẽ <strong>không thể đọc được số lượng vote</strong>.' +
            '</p>' +
            '<div class="github-status-box">' +
              '<div class="github-status-text">' +
                '<strong>Trạng thái:</strong> ' + escapeHtml(syncState.message || 'Chưa cấu hình') +
              '</div>' +
              '<div style="font-size:0.8rem; color:#CFBA94;">' +
                (syncState.lastSyncTime ? 'Đồng bộ lúc: ' + new Date(syncState.lastSyncTime).toLocaleTimeString() : '') +
              '</div>' +
            '</div>' +
            '<div class="github-config-grid">' +
              '<div class="field">' +
                '<label>GitHub Owner / Username</label>' +
                '<input type="text" id="gh-owner" value="' + escapeHtml(ghConfig.owner) + '">' +
              '</div>' +
              '<div class="field">' +
                '<label>GitHub Repository</label>' +
                '<input type="text" id="gh-repo" value="' + escapeHtml(ghConfig.repo) + '">' +
              '</div>' +
              '<div class="field">' +
                '<label>Branch</label>' +
                '<input type="text" id="gh-branch" value="' + escapeHtml(ghConfig.branch) + '">' +
              '</div>' +
              '<div class="field">' +
                '<label>File Path</label>' +
                '<input type="text" id="gh-path" value="' + escapeHtml(ghConfig.path) + '">' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<label>GitHub Personal Access Token (PAT)</label>' +
              '<input type="password" id="gh-token" value="' + escapeHtml(ghConfig.token) + '" placeholder="ghp_xxxxxxxxxxxx hoặc github_pat_xxxxxxxxxxxx">' +
              '<div class="field-hint" style="color:#CFBA94;">Token cần quyền <code>repo</code> (hoặc <code>contents:write</code>) để ghi dữ liệu bình chọn trực tiếp lên GitHub repo.</div>' +
            '</div>' +
            '<div class="github-config-actions">' +
              '<button type="button" class="btn btn-secondary" id="save-gh-config-btn">Lưu cấu hình</button>' +
              '<button type="button" class="btn btn-outline" id="test-gh-btn" style="color:#FFF; border-color:var(--gold);">Kiểm tra kết nối</button>' +
              '<button type="button" class="btn btn-outline" id="push-gh-btn" style="color:#FFF; border-color:var(--gold);">Đẩy dữ liệu lên GitHub (Push)</button>' +
              '<button type="button" class="btn btn-outline" id="pull-gh-btn" style="color:#FFF; border-color:var(--gold);">Kéo dữ liệu từ GitHub (Pull)</button>' +
            '</div>' +
            '<div id="gh-test-result" style="margin-top:14px; font-size:0.88rem;"></div>' +
          '</div>' +

          // Block 4: Đổi Mật Khẩu Admin
          '<div class="admin-block">' +
            '<h3>🔑 Đổi Mật Khẩu Quản Trị</h3>' +
            '<div class="field" style="max-width:380px;">' +
              '<label for="change-pass-inp">Mật khẩu quản trị mới</label>' +
              '<input type="password" id="change-pass-inp" placeholder="Nhập mật khẩu mới...">' +
            '</div>' +
            '<button type="button" class="btn btn-secondary" id="change-pass-btn" style="font-size:0.88rem;">Cập nhật mật khẩu</button>' +
          '</div>' +

          // Block 5: Sao lưu / Phục hồi
          '<div class="admin-block">' +
            '<h3>💾 Sao lưu & Phục hồi dữ liệu JSON</h3>' +
            '<p style="font-size:0.88rem; color:var(--ink-soft); margin-bottom:14px;">' +
              'Xuất dữ liệu gốc ra máy tính hoặc nạp dữ liệu từ file sao lưu.' +
            '</p>' +
            '<div style="display:flex; gap:12px; flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-outline" id="export-json-btn">⬇️ Xuất dữ liệu JSON</button>' +
              '<label class="btn btn-outline" style="cursor:pointer; margin:0;">' +
                '⬆️ Nhập dữ liệu JSON' +
                '<input type="file" id="import-json-file" accept=".json" style="display:none;">' +
              '</label>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Xử lý Upload file ảnh cho Concept Mới
      var fImgFileInp = document.getElementById('f-img-file');
      if (fImgFileInp) {
        fImgFileInp.addEventListener('change', async function (e) {
          var file = e.target.files[0];
          if (!file) return;
          var dataUrl = await readFileAsDataURL(file);
          if (dataUrl) {
            document.getElementById('f-img').value = dataUrl;
            var prevBox = document.getElementById('f-img-preview-box');
            var prevThumb = document.getElementById('f-img-preview-thumb');
            var prevName = document.getElementById('f-img-preview-name');
            if (prevBox && prevThumb && prevName) {
              prevThumb.src = dataUrl;
              prevName.textContent = file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
              prevBox.style.display = 'inline-flex';
            }
          }
        });
      }

      // Đổi Mật Khẩu Admin
      document.getElementById('change-pass-btn').addEventListener('click', async function () {
        var newPass = document.getElementById('change-pass-inp').value.trim();
        if (!newPass) {
          window.showToast('Vui lòng nhập mật khẩu mới.');
          return;
        }
        var hashed = await hashPassword(newPass);
        setAdminPasswordHash(hashed);
        document.getElementById('change-pass-inp').value = '';
        window.showToast('Đã đổi mật khẩu quản trị thành công!');
      });

      // Gắn sự kiện đăng xuất
      document.getElementById('admin-logout-btn').addEventListener('click', function () {
        setAuth(false);
        self.renderLogin(container, appState, onDataChange);
      });

      // Render danh sách ấn phẩm đang soạn cho Concept mới
      function renderPendingAssets() {
        var pendingContainer = document.getElementById('pending-assets-container');
        if (!pendingContainer) return;
        pendingContainer.innerHTML = adminState.pendingNewAssets.map(function (a, i) {
          return (
            '<div class="asset-row-edit" style="grid-template-columns: 1.2fr 2fr auto auto; gap:8px;">' +
              '<input type="text" placeholder="Tên ấn phẩm (VD: Avatar, Standee...)" data-pending-title="' + i + '" value="' + escapeHtml(a.title) + '">' +
              '<input type="text" placeholder="Link ảnh hoặc file" data-pending-link="' + i + '" value="' + escapeHtml(a.fileUrl) + '">' +
              '<label class="btn-upload-file" style="padding:6px 10px; font-size:0.78rem;">' +
                '📁 Up ảnh' +
                '<input type="file" accept="image/*" data-pending-file="' + i + '">' +
              '</label>' +
              '<button type="button" class="btn-text" data-pending-del="' + i + '">Xóa</button>' +
            '</div>'
          );
        }).join('');

        pendingContainer.querySelectorAll('[data-pending-title]').forEach(function (inp) {
          inp.addEventListener('input', function () {
            adminState.pendingNewAssets[+this.getAttribute('data-pending-title')].title = this.value;
          });
        });
        pendingContainer.querySelectorAll('[data-pending-link]').forEach(function (inp) {
          inp.addEventListener('input', function () {
            adminState.pendingNewAssets[+this.getAttribute('data-pending-link')].fileUrl = this.value;
          });
        });
        pendingContainer.querySelectorAll('[data-pending-file]').forEach(function (fileInp) {
          fileInp.addEventListener('change', async function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var dataUrl = await readFileAsDataURL(file);
            var idx = +this.getAttribute('data-pending-file');
            if (dataUrl && adminState.pendingNewAssets[idx]) {
              adminState.pendingNewAssets[idx].fileUrl = dataUrl;
              if (!adminState.pendingNewAssets[idx].title) {
                adminState.pendingNewAssets[idx].title = file.name.replace(/\.[^/.]+$/, '');
              }
              renderPendingAssets();
            }
          });
        });
        pendingContainer.querySelectorAll('[data-pending-del]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            adminState.pendingNewAssets.splice(+this.getAttribute('data-pending-del'), 1);
            renderPendingAssets();
          });
        });
      }
      renderPendingAssets();

      document.getElementById('add-pending-asset-row-btn').addEventListener('click', function () {
        adminState.pendingNewAssets.push({ title: '', fileUrl: '' });
        renderPendingAssets();
      });

      // Thêm Concept Mới
      document.getElementById('add-concept-btn').addEventListener('click', async function () {
        var name = document.getElementById('f-name').value.trim();
        var img = document.getElementById('f-img').value.trim();
        var desc = document.getElementById('f-desc').value.trim();
        var justify = document.getElementById('f-justify').value.trim();
        var errEl = document.getElementById('add-concept-error');

        if (!name || !img || !desc) {
          errEl.textContent = 'Vui lòng điền đầy đủ Tên, Ảnh đại diện và Mô tả concept.';
          return;
        }
        errEl.textContent = '';
        this.disabled = true;
        this.textContent = 'Đang lưu & đồng bộ...';

        var newConcept = {
          id: 'concept-' + Date.now(),
          name: name,
          imageUrl: img,
          description: desc,
          justification: justify,
          votes: 0,
          createdAt: Date.now(),
          assets: adminState.pendingNewAssets
            .filter(function (a) { return a.title.trim() && a.fileUrl.trim(); })
            .map(function (a) {
              return {
                id: 'asset-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                title: a.title.trim(),
                fileUrl: a.fileUrl.trim(),
              };
            }),
        };

        appState.concepts.push(newConcept);
        await window.JpStorage.saveData(appState, 'Add concept "' + newConcept.name + '" [skip ci]');
        adminState.pendingNewAssets = [];
        window.showToast('Đã thêm concept "' + newConcept.name + '" thành công!');
        if (onDataChange) onDataChange();
        self.renderDashboard(container, appState, onDataChange);
      });

      // Toggle Inline Edit Concept
      container.querySelectorAll('[data-toggle-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = this.getAttribute('data-toggle-edit');
          adminState.expandedEditId = (adminState.expandedEditId === id) ? null : id;
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      container.querySelectorAll('[data-cancel-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          adminState.expandedEditId = null;
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Upload file cho Edit Concept
      if (adminState.expandedEditId) {
        var editFileInp = document.getElementById('edit-img-file-' + adminState.expandedEditId);
        if (editFileInp) {
          editFileInp.addEventListener('change', async function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var dataUrl = await readFileAsDataURL(file);
            if (dataUrl) {
              document.getElementById('edit-img-' + adminState.expandedEditId).value = dataUrl;
              var thumb = document.getElementById('edit-preview-thumb-' + adminState.expandedEditId);
              var nameSpan = document.getElementById('edit-preview-name-' + adminState.expandedEditId);
              if (thumb && nameSpan) {
                thumb.src = dataUrl;
                nameSpan.textContent = file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
              }
            }
          });
        }
      }

      // Lưu thay đổi Edit Concept
      container.querySelectorAll('[data-save-edit]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = this.getAttribute('data-save-edit');
          var name = document.getElementById('edit-name-' + id).value.trim();
          var img = document.getElementById('edit-img-' + id).value.trim();
          var desc = document.getElementById('edit-desc-' + id).value.trim();
          var justify = document.getElementById('edit-justify-' + id).value.trim();
          var errEl = document.getElementById('edit-error-' + id);

          if (!name || !img || !desc) {
            if (errEl) errEl.textContent = 'Vui lòng điền đầy đủ Tên, Ảnh và Mô tả.';
            return;
          }

          var target = appState.concepts.find(function (c) { return c.id === id; });
          if (!target) return;

          this.disabled = true;
          this.textContent = 'Đang lưu...';

          target.name = name;
          target.imageUrl = img;
          target.description = desc;
          target.justification = justify;

          await window.JpStorage.saveData(appState, 'Edit concept "' + target.name + '" [skip ci]');
          adminState.expandedEditId = null;
          window.showToast('Đã cập nhật thông tin concept!');
          if (onDataChange) onDataChange();
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Toggle Quản lý Ấn phẩm
      container.querySelectorAll('[data-toggle-assets]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = this.getAttribute('data-toggle-assets');
          adminState.expandedAssetsId = (adminState.expandedAssetsId === id) ? null : id;
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Upload file cho ấn phẩm có sẵn
      container.querySelectorAll('[data-asset-file]').forEach(function (fileInp) {
        fileInp.addEventListener('change', async function (e) {
          var file = e.target.files[0];
          if (!file) return;
          var dataUrl = await readFileAsDataURL(file);
          var parts = this.getAttribute('data-asset-file').split('|');
          var target = appState.concepts.find(function (c) { return c.id === parts[0]; });
          if (target && target.assets) {
            var asset = target.assets.find(function (a) { return a.id === parts[1]; });
            if (asset && dataUrl) {
              asset.fileUrl = dataUrl;
              await window.JpStorage.saveData(appState);
              window.showToast('Đã tải ảnh lên cho ấn phẩm "' + asset.title + '"!');
              if (onDataChange) onDataChange();
              self.renderDashboard(container, appState, onDataChange);
            }
          }
        });
      });

      // Upload file cho ấn phẩm mới trong Concept đã tạo
      if (adminState.expandedAssetsId) {
        var newAssetFileInp = document.getElementById('new-asset-file-' + adminState.expandedAssetsId);
        if (newAssetFileInp) {
          newAssetFileInp.addEventListener('change', async function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var dataUrl = await readFileAsDataURL(file);
            if (dataUrl) {
              document.getElementById('new-asset-link-' + adminState.expandedAssetsId).value = dataUrl;
              var titleInp = document.getElementById('new-asset-title-' + adminState.expandedAssetsId);
              if (titleInp && !titleInp.value.trim()) {
                titleInp.value = file.name.replace(/\.[^/.]+$/, '');
              }
            }
          });
        }
      }

      // Thêm ấn phẩm mới cho concept
      container.querySelectorAll('[data-asset-add]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var cid = this.getAttribute('data-asset-add');
          var titleInp = document.getElementById('new-asset-title-' + cid);
          var linkInp = document.getElementById('new-asset-link-' + cid);
          var title = titleInp.value.trim();
          var link = linkInp.value.trim();

          if (!title || !link) {
            window.showToast('Vui lòng nhập đầy đủ Tên và Đường dẫn ấn phẩm (hoặc tải file).');
            return;
          }

          var target = appState.concepts.find(function (c) { return c.id === cid; });
          if (!target) return;
          if (!target.assets) target.assets = [];

          target.assets.push({
            id: 'asset-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            title: title,
            fileUrl: link,
          });

          await window.JpStorage.saveData(appState, 'Add asset to "' + target.name + '" [skip ci]');
          window.showToast('Đã thêm ấn phẩm mới!');
          if (onDataChange) onDataChange();
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Sửa ấn phẩm inline
      container.querySelectorAll('[data-asset-title]').forEach(function (inp) {
        inp.addEventListener('change', async function () {
          var parts = this.getAttribute('data-asset-title').split('|');
          var target = appState.concepts.find(function (c) { return c.id === parts[0]; });
          if (target && target.assets) {
            var asset = target.assets.find(function (a) { return a.id === parts[1]; });
            if (asset) {
              asset.title = inp.value.trim();
              await window.JpStorage.saveData(appState);
            }
          }
        });
      });

      container.querySelectorAll('[data-asset-link]').forEach(function (inp) {
        inp.addEventListener('change', async function () {
          var parts = this.getAttribute('data-asset-link').split('|');
          var target = appState.concepts.find(function (c) { return c.id === parts[0]; });
          if (target && target.assets) {
            var asset = target.assets.find(function (a) { return a.id === parts[1]; });
            if (asset) {
              asset.fileUrl = inp.value.trim();
              await window.JpStorage.saveData(appState);
            }
          }
        });
      });

      // Xóa ấn phẩm
      container.querySelectorAll('[data-asset-del]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var parts = this.getAttribute('data-asset-del').split('|');
          var target = appState.concepts.find(function (c) { return c.id === parts[0]; });
          if (target && target.assets) {
            target.assets = target.assets.filter(function (a) { return a.id !== parts[1]; });
            await window.JpStorage.saveData(appState, 'Delete asset from "' + target.name + '" [skip ci]');
            window.showToast('Đã xóa ấn phẩm!');
            if (onDataChange) onDataChange();
            self.renderDashboard(container, appState, onDataChange);
          }
        });
      });

      // Xóa Concept
      container.querySelectorAll('[data-del-concept]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = this.getAttribute('data-del-concept');
          var target = appState.concepts.find(function (c) { return c.id === id; });
          if (!target) return;

          if (!confirm('Bạn có chắc chắn muốn xóa concept "' + target.name + '"? Hành động này không thể hoàn tác.')) {
            return;
          }

          appState.concepts = appState.concepts.filter(function (c) { return c.id !== id; });
          if (adminState.expandedEditId === id) adminState.expandedEditId = null;
          if (adminState.expandedAssetsId === id) adminState.expandedAssetsId = null;

          await window.JpStorage.saveData(appState, 'Delete concept "' + target.name + '" [skip ci]');
          window.showToast('Đã xóa concept "' + target.name + '" thành công!');
          if (onDataChange) onDataChange();
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Reset Vote 1 Concept
      container.querySelectorAll('[data-reset-vote]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = this.getAttribute('data-reset-vote');
          var target = appState.concepts.find(function (c) { return c.id === id; });
          if (!target) return;

          if (!confirm('Đặt lại số lượt bình chọn của concept "' + target.name + '" về 0?')) {
            return;
          }

          target.votes = 0;
          await window.JpStorage.saveData(appState, 'Reset votes for concept "' + target.name + '" [skip ci]');
          window.showToast('Đã đặt lại số vote của "' + target.name + '" về 0.');
          if (onDataChange) onDataChange();
          self.renderDashboard(container, appState, onDataChange);
        });
      });

      // Reset Toàn Bộ Vote
      var resetAllBtn = document.getElementById('reset-all-votes-btn');
      if (resetAllBtn) {
        resetAllBtn.addEventListener('click', async function () {
          if (!confirm('⚠️ CẢNH BÁO: Bạn có chắc chắn muốn RESET TẤT CẢ LƯỢT BÌNH CHỌN của toàn bộ concept về 0?')) {
            return;
          }

          resetAllBtn.disabled = true;
          resetAllBtn.textContent = 'Đang reset toàn bộ...';

          appState.concepts.forEach(function (c) {
            c.votes = 0;
          });
          appState.lastReset = Date.now();
          window.JpStorage.clearVotedMap();

          await window.JpStorage.saveData(appState, 'Reset all concept votes to 0 [skip ci]');
          window.showToast('Đã đặt lại tất cả lượt bình chọn về 0 thành công!');
          if (onDataChange) onDataChange();
          self.renderDashboard(container, appState, onDataChange);
        });
      }

      // Lưu Cấu hình GitHub
      document.getElementById('save-gh-config-btn').addEventListener('click', function () {
        var owner = document.getElementById('gh-owner').value.trim();
        var repo = document.getElementById('gh-repo').value.trim();
        var branch = document.getElementById('gh-branch').value.trim();
        var path = document.getElementById('gh-path').value.trim();
        var token = document.getElementById('gh-token').value.trim();

        window.JpStorage.saveConfig({
          owner: owner,
          repo: repo,
          branch: branch,
          path: path,
          token: token,
          autoSync: true,
        });

        window.showToast('Đã lưu cấu hình GitHub!');
        self.renderDashboard(container, appState, onDataChange);
      });

      // Kiểm tra kết nối GitHub
      document.getElementById('test-gh-btn').addEventListener('click', async function () {
        var resultEl = document.getElementById('gh-test-result');
        resultEl.innerHTML = '<span style="color:#CFBA94;">⏳ Đang kiểm tra kết nối tới GitHub API...</span>';

        var owner = document.getElementById('gh-owner').value.trim();
        var repo = document.getElementById('gh-repo').value.trim();
        var branch = document.getElementById('gh-branch').value.trim();
        var path = document.getElementById('gh-path').value.trim();
        var token = document.getElementById('gh-token').value.trim();

        var res = await window.JpStorage.testConnection({ owner: owner, repo: repo, branch: branch, path: path, token: token });
        if (res.success) {
          resultEl.innerHTML = '<span style="color:#6BE585;">✅ ' + escapeHtml(res.message) + '</span>';
        } else {
          resultEl.innerHTML = '<span style="color:#FF7675;">❌ ' + escapeHtml(res.message) + '</span>';
        }
      });

      // Đẩy dữ liệu lên GitHub thủ công
      document.getElementById('push-gh-btn').addEventListener('click', async function () {
        this.disabled = true;
        this.textContent = 'Đang đẩy lên GitHub...';
        var res = await window.JpStorage.manualPush(appState);
        if (res.success) {
          window.showToast('Đã đẩy toàn bộ dữ liệu lên GitHub thành công!');
        } else {
          window.showToast('Lỗi đẩy dữ liệu lên GitHub: ' + (res.reason || 'Xem lại Token/Quyền'));
        }
        self.renderDashboard(container, appState, onDataChange);
      });

      // Kéo dữ liệu từ GitHub thủ công
      document.getElementById('pull-gh-btn').addEventListener('click', async function () {
        this.disabled = true;
        this.textContent = 'Đang tải từ GitHub...';
        var data = await window.JpStorage.manualPull();
        if (data && data.concepts) {
          appState.concepts = data.concepts;
          appState.lastReset = data.lastReset;
          window.showToast('Đã kéo dữ liệu mới nhất từ GitHub!');
          if (onDataChange) onDataChange();
        } else {
          window.showToast('Không thể tải dữ liệu từ GitHub.');
        }
        self.renderDashboard(container, appState, onDataChange);
      });

      // Xuất JSON
      document.getElementById('export-json-btn').addEventListener('click', function () {
        var str = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState, null, 2));
        var downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', str);
        downloadAnchor.setAttribute('download', 'yourJPconcept-backup-' + new Date().toISOString().slice(0, 10) + '.json');
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });

      // Nhập JSON
      document.getElementById('import-json-file').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = async function (evt) {
          try {
            var imported = JSON.parse(evt.target.result);
            if (imported.concepts && Array.isArray(imported.concepts)) {
              appState.concepts = imported.concepts;
              appState.lastReset = imported.lastReset;
              await window.JpStorage.saveData(appState, 'Imported concepts JSON backup [skip ci]');
              window.showToast('Đã nạp dữ liệu từ file JSON thành công!');
              if (onDataChange) onDataChange();
              self.renderDashboard(container, appState, onDataChange);
            } else {
              alert('File JSON không đúng định dạng yourJPconcept.');
            }
          } catch (err) {
            alert('Lỗi đọc file JSON: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    },
  };

  window.JpAdmin = JpAdmin;
})(window);
