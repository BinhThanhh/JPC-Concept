/**
 * yourJPconcept - Storage & GitHub Sync Module
 * Quản lý lưu trữ dữ liệu, mã hóa bảo mật và đồng bộ hai chiều với GitHub Repository.
 */

(function (window) {
  'use strict';

  var DEFAULT_GITHUB_OWNER = 'BinhThanhh';
  var DEFAULT_GITHUB_REPO = 'JPC-Concept';
  var DEFAULT_GITHUB_BRANCH = 'main';
  var DEFAULT_DATA_PATH = 'data/data.json';

  var LOCAL_CACHE_KEY = 'yjp_data_cache';
  var LOCAL_VOTED_KEY = 'yjp_voted_map';
  var LOCAL_CONFIG_KEY = 'yjp_github_config';

  // Trạng thái đồng bộ hiện tại
  var syncState = {
    isSyncing: false,
    lastSyncTime: null,
    status: 'idle', // 'idle' | 'syncing' | 'success' | 'error' | 'local-only'
    message: '',
    githubSha: null,
  };

  var listeners = [];

  function notifySyncChange() {
    listeners.forEach(function (fn) {
      try {
        fn(syncState);
      } catch (e) {
        console.error(e);
      }
    });
  }

  // Lấy cấu hình GitHub từ LocalStorage
  function getGitHubConfig() {
    try {
      var raw = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return {
          owner: parsed.owner || DEFAULT_GITHUB_OWNER,
          repo: parsed.repo || DEFAULT_GITHUB_REPO,
          branch: parsed.branch || DEFAULT_GITHUB_BRANCH,
          path: parsed.path || DEFAULT_DATA_PATH,
          token: parsed.token || '',
          autoSync: parsed.autoSync !== false,
        };
      }
    } catch (e) {}

    return {
      owner: DEFAULT_GITHUB_OWNER,
      repo: DEFAULT_GITHUB_REPO,
      branch: DEFAULT_GITHUB_BRANCH,
      path: DEFAULT_DATA_PATH,
      token: '',
      autoSync: true,
    };
  }

  // Lưu cấu hình GitHub vào LocalStorage
  function saveGitHubConfig(cfg) {
    var merged = Object.assign(getGitHubConfig(), cfg);
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(merged));
    return merged;
  }

  // Kiểm tra kết nối GitHub API với Token
  async function testGitHubConnection(cfg) {
    var config = Object.assign({}, getGitHubConfig(), cfg || {});
    if (!config.token) {
      return { success: false, message: 'Chưa nhập GitHub Personal Access Token.' };
    }

    try {
      var res = await fetch('https://api.github.com/repos/' + config.owner + '/' + config.repo, {
        headers: {
          Authorization: 'Bearer ' + config.token.trim(),
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (res.status === 200) {
        var data = await res.json();
        return {
          success: true,
          message: 'Kết nối thành công tới repo ' + data.full_name,
          repo: data,
        };
      } else if (res.status === 401) {
        return { success: false, message: 'Token không hợp lệ hoặc đã hết hạn (401 Unauthorized).' };
      } else if (res.status === 404) {
        // Thử kiểm tra qua contents endpoint (dành cho Fine-Grained Token)
        var contentRes = await fetch('https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/' + config.path + '?ref=' + config.branch, {
          headers: {
            Authorization: 'Bearer ' + config.token.trim(),
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (contentRes.status === 200) {
          var cData = await contentRes.json();
          syncState.githubSha = cData.sha;
          return {
            success: true,
            message: 'Kết nối thành công tới repo ' + config.owner + '/' + config.repo,
          };
        }
        return { success: false, message: 'Không tìm thấy repository (' + config.owner + '/' + config.repo + ') hoặc Token không có quyền truy cập repo này (404 Not Found).' };
      } else {
        return { success: false, message: 'Lỗi GitHub API: HTTP ' + res.status };
      }
    } catch (err) {
      return { success: false, message: 'Lỗi mạng khi kết nối GitHub: ' + err.message };
    }
  }

  // Tải SHA hiện tại của file trên GitHub để commit đè an toàn (tránh 409 Conflict)
  async function fetchFileSha(config) {
    if (!config.token) return null;
    try {
      var url = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/' + config.path + '?ref=' + config.branch + '&t=' + Date.now();
      var res = await fetch(url, {
        headers: {
          Authorization: 'Bearer ' + config.token.trim(),
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (res.status === 200) {
        var data = await res.json();
        syncState.githubSha = data.sha;
        return data.sha;
      }
    } catch (e) {}
    return null;
  }

  // Push file mã hóa lên GitHub repository
  async function pushEnvelopeToGitHub(envelope, commitMessage) {
    var config = getGitHubConfig();
    if (!config.token) {
      syncState.status = 'local-only';
      syncState.message = 'Chưa cấu hình Token GitHub — dữ liệu đang lưu trong bộ nhớ máy (Local).';
      notifySyncChange();
      return { success: false, reason: 'no-token' };
    }

    syncState.isSyncing = true;
    syncState.status = 'syncing';
    syncState.message = 'Đang đẩy dữ liệu mã hóa lên GitHub repo...';
    notifySyncChange();

    try {
      // Lấy SHA mới nhất trước khi commit
      var sha = await fetchFileSha(config);

      var jsonString = JSON.stringify(envelope, null, 2);
      // Mã hóa UTF-8 sang Base64 chuẩn cho GitHub Contents API
      var utf8Bytes = new TextEncoder().encode(jsonString);
      var binaryStr = '';
      for (var i = 0; i < utf8Bytes.length; i++) {
        binaryStr += String.fromCharCode(utf8Bytes[i]);
      }
      var base64Content = window.btoa(binaryStr);

      var bodyData = {
        message: commitMessage || 'Update concepts and votes [skip ci]',
        content: base64Content,
        branch: config.branch,
      };
      if (sha) {
        bodyData.sha = sha;
      }

      var url = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/' + config.path;
      var res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + config.token.trim(),
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
      });

      if (res.ok) {
        var resData = await res.json();
        syncState.githubSha = resData.content ? resData.content.sha : null;
        syncState.isSyncing = false;
        syncState.status = 'success';
        syncState.lastSyncTime = new Date();
        syncState.message = 'Đã đồng bộ an toàn lên GitHub (' + config.owner + '/' + config.repo + ')';
        notifySyncChange();
        return { success: true };
      } else {
        var errBody = await res.json().catch(function () { return {}; });
        syncState.isSyncing = false;
        syncState.status = 'error';
        syncState.message = 'Lỗi đẩy GitHub (HTTP ' + res.status + '): ' + (errBody.message || '');
        notifySyncChange();
        return { success: false, error: errBody };
      }
    } catch (err) {
      syncState.isSyncing = false;
      syncState.status = 'error';
      syncState.message = 'Lỗi kết nối GitHub: ' + err.message;
      notifySyncChange();
      return { success: false, error: err };
    }
  }

  // Helper tải dữ liệu ban đầu và hợp nhất thông minh với Local Storage
  async function fetchRemoteData() {
    var config = getGitHubConfig();
    var remoteData = null;

    // 1. Thử lấy từ GitHub API nếu có token (dành cho Admin)
    if (config.token) {
      try {
        var apiUrl = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/' + config.path + '?ref=' + config.branch + '&t=' + Date.now();
        var apiRes = await fetch(apiUrl, {
          headers: {
            Authorization: 'Bearer ' + config.token.trim(),
            Accept: 'application/vnd.github.v3+json',
          },
          cache: 'no-cache',
        });
        if (apiRes.ok) {
          var fileData = await apiRes.json();
          syncState.githubSha = fileData.sha;
          // Giải mã content base64
          var decodedContent = decodeURIComponent(escape(window.atob(fileData.content.replace(/\s/g, ''))));
          var rawJson = JSON.parse(decodedContent);
          var decrypted = await window.JpCrypto.decrypt(rawJson);
          if (decrypted && decrypted.concepts) {
            remoteData = decrypted;
            syncState.status = 'success';
            syncState.message = 'Đã tải dữ liệu mới nhất từ GitHub';
            syncState.lastSyncTime = new Date();
            notifySyncChange();
          }
        }
      } catch (e) {
        console.warn('Không thể tải qua GitHub API có token:', e);
      }
    }

    // 2. Thử lấy trực tiếp từ GitHub Raw CDN (Thời gian thực, không chờ GitHub Pages build, không cần token)
    if (!remoteData) {
      try {
        var rawUrl = 'https://raw.githubusercontent.com/' + config.owner + '/' + config.repo + '/' + config.branch + '/' + config.path + '?t=' + Date.now();
        var rawRes = await fetch(rawUrl, { cache: 'no-cache' });
        if (rawRes.ok) {
          var rawJson = await rawRes.json();
          var decryptedRaw = await window.JpCrypto.decrypt(rawJson);
          if (decryptedRaw && decryptedRaw.concepts) {
            remoteData = decryptedRaw;
            syncState.status = 'success';
            syncState.message = 'Đã tải dữ liệu mới nhất từ GitHub';
            syncState.lastSyncTime = new Date();
            notifySyncChange();
          }
        }
      } catch (e) {
        console.warn('Không thể tải qua GitHub Raw CDN:', e);
      }
    }

    // 3. Thử lấy qua GitHub API công khai (không cần token)
    if (!remoteData) {
      try {
        var pubApiUrl = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/' + config.path + '?ref=' + config.branch + '&t=' + Date.now();
        var pubRes = await fetch(pubApiUrl, {
          headers: { Accept: 'application/vnd.github.v3+json' },
          cache: 'no-cache',
        });
        if (pubRes.ok) {
          var pubData = await pubRes.json();
          syncState.githubSha = pubData.sha;
          var decodedContent = decodeURIComponent(escape(window.atob(pubData.content.replace(/\s/g, ''))));
          var rawJson = JSON.parse(decodedContent);
          var decryptedPub = await window.JpCrypto.decrypt(rawJson);
          if (decryptedPub && decryptedPub.concepts) {
            remoteData = decryptedPub;
          }
        }
      } catch (e) {
        console.warn('Không thể tải qua GitHub API công khai:', e);
      }
    }

    // 4. Thử tải file tĩnh data/data.json đi kèm trang web (fallback dự phòng)
    if (!remoteData) {
      try {
        var staticRes = await fetch('data/data.json?t=' + Date.now(), { cache: 'no-cache' });
        if (staticRes.ok) {
          var rawStaticJson = await staticRes.json();
          var decryptedStatic = await window.JpCrypto.decrypt(rawStaticJson);
          if (decryptedStatic && decryptedStatic.concepts) {
            remoteData = decryptedStatic;
          }
        }
      } catch (e) {
        console.warn('Không thể tải data/data.json tĩnh:', e);
      }
    }

    // 3. Đọc Local Cache và Voted Map từ LocalStorage
    var localCached = null;
    try {
      var cached = localStorage.getItem(LOCAL_CACHE_KEY);
      if (cached) {
        localCached = JSON.parse(cached);
      }
    } catch (e) {}

    var votedMap = {};
    try {
      var rawVoted = localStorage.getItem(LOCAL_VOTED_KEY);
      if (rawVoted) votedMap = JSON.parse(rawVoted);
    } catch (e) {}

    // Nếu không có remoteData thì dùng localCached
    if (!remoteData) {
      return localCached;
    }

    // Nếu có remoteData nhưng không có localCached:
    if (!localCached || !localCached.concepts) {
      if (remoteData.concepts) {
        remoteData.concepts.forEach(function (c) {
          if (votedMap[c.id] && (!c.votes || c.votes < 1)) {
            c.votes = 1;
          }
        });
      }
      return remoteData;
    }

    // Kiểm tra nếu Admin đã thực hiện Reset Vote trên GitHub (lastReset trên GitHub mới hơn local)
    var remoteReset = remoteData.lastReset || 0;
    var localReset = localCached.lastReset || 0;
    if (remoteReset > localReset) {
      // Admin đã reset trên GitHub -> xóa bỏ voted map của client
      try {
        localStorage.removeItem(LOCAL_VOTED_KEY);
      } catch (e) {}
      return remoteData;
    }

    // HỢP NHẤT THÔNG MINH (Smart Merge):
    // Cập nhật thông tin mới nhất từ remote (Tên, Ảnh, Mô tả, Ấn phẩm đính kèm)
    // Nhưng bảo toàn số vote từ local cache (tránh bị reset về 0 khi reload trang)
    var localConceptMap = {};
    (localCached.concepts || []).forEach(function (lc) {
      localConceptMap[lc.id] = lc;
    });

    remoteData.concepts.forEach(function (rc) {
      var lc = localConceptMap[rc.id];
      if (lc) {
        var maxVotes = Math.max(rc.votes || 0, lc.votes || 0);
        if (votedMap[rc.id] && maxVotes === 0) {
          maxVotes = 1;
        }
        rc.votes = maxVotes;
      } else if (votedMap[rc.id] && (!rc.votes || rc.votes === 0)) {
        rc.votes = 1;
      }
    });

    // Nếu có concept mới tạo trên local mà chưa kịp push lên git
    (localCached.concepts || []).forEach(function (lc) {
      var existsInRemote = remoteData.concepts.some(function (rc) { return rc.id === lc.id; });
      if (!existsInRemote) {
        remoteData.concepts.push(lc);
      }
    });

    return remoteData;
  }

  var JpStorage = {
    getSyncState: function () {
      return syncState;
    },

    onSyncChange: function (fn) {
      listeners.push(fn);
    },

    getConfig: getGitHubConfig,
    saveConfig: saveGitHubConfig,
    testConnection: testGitHubConnection,

    /**
     * Tải toàn bộ dữ liệu (tự động giải mã payload an toàn)
     */
    loadData: async function () {
      syncState.status = 'syncing';
      syncState.message = 'Đang tải dữ liệu concept...';
      notifySyncChange();

      var data = await fetchRemoteData();
      if (!data) {
        data = { concepts: [], lastReset: null };
      }

      // Lưu cache local
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
      } catch (e) {}

      var cfg = getGitHubConfig();
      if (!cfg.token) {
        syncState.status = 'local-only';
        syncState.message = 'Chế độ Local (Nhập Token GitHub trong Admin để đồng bộ đám mây)';
      }
      notifySyncChange();

      return data;
    },

    /**
     * Lưu dữ liệu: Mã hóa bằng JpCrypto và lưu vào LocalStorage + Tự động commit lên GitHub nếu có token
     */
    saveData: async function (dataObj, commitMsg) {
      if (!dataObj || !dataObj.concepts) return { success: false, message: 'Dữ liệu không hợp lệ' };

      // 1. Lưu Local Cache
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(dataObj));
      } catch (e) {}

      // 2. Mã hóa dữ liệu bảo mật
      var envelope = await window.JpCrypto.encrypt(dataObj);

      // 3. Tự động đẩy lên GitHub
      var cfg = getGitHubConfig();
      if (cfg.token && cfg.autoSync) {
        return await pushEnvelopeToGitHub(envelope, commitMsg || 'Update concepts and votes [skip ci]');
      }

      return { success: true, localOnly: true };
    },

    /**
     * Đồng bộ thủ công đẩy toàn bộ dữ liệu hiện tại lên GitHub
     */
    manualPush: async function (dataObj) {
      var envelope = await window.JpCrypto.encrypt(dataObj);
      return pushEnvelopeToGitHub(envelope, 'Manual sync from Admin Panel [skip ci]');
    },

    /**
     * Kéo dữ liệu mới nhất từ GitHub về đè lên local
     */
    manualPull: async function () {
      return this.loadData();
    },

    /**
     * Lấy danh sách các concept mà trình duyệt hiện tại đã vote
     */
    getVotedMap: function () {
      try {
        var raw = localStorage.getItem(LOCAL_VOTED_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },

    /**
     * Đánh dấu đã vote cho 1 concept trên trình duyệt này
     */
    setVoted: function (conceptId) {
      var map = this.getVotedMap();
      map[conceptId] = Date.now();
      try {
        localStorage.setItem(LOCAL_VOTED_KEY, JSON.stringify(map));
      } catch (e) {}
    },

    /**
     * Xóa đánh dấu vote (khi admin reset vote)
     */
    clearVotedMap: function () {
      try {
        localStorage.removeItem(LOCAL_VOTED_KEY);
      } catch (e) {}
    },
  };

  window.JpStorage = JpStorage;
})(window);
