/**
 * yourJPconcept - Crypto Module
 * Module mã hóa & giải mã dữ liệu (AES / Web Crypto) để bảo mật file JSON trên GitHub repo.
 * Người xem trực tiếp repo trên GitHub sẽ không thể đọc được số lượng vote hay nội dung thô.
 */

(function (window) {
  'use strict';

  // Khóa bí mật mặc định của dự án để mã hóa dữ liệu công khai trên repo
  var APP_SECRET = 'yourJPconcept-secret-key-2026-v2';
  var SALT = 'jpc-sakura-salt-99';

  // Chuyển đổi ArrayBuffer sang Base64
  function bufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  // Chuyển đổi Base64 sang ArrayBuffer
  function base64ToBuffer(base64) {
    var binary = window.atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Tạo Key từ passphrase bằng PBKDF2 / SHA-256 (Web Crypto)
  async function deriveKey(passphrase) {
    var enc = new TextEncoder();
    var keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase || APP_SECRET),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(SALT),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Fallback cipher (cho trường hợp file:// hoặc trình duyệt cũ không bật crypto.subtle)
  function fallbackEncrypt(plainText, key) {
    var k = key || APP_SECRET;
    var enc = encodeURIComponent(plainText);
    var out = '';
    for (var i = 0; i < enc.length; i++) {
      var c = enc.charCodeAt(i) ^ k.charCodeAt(i % k.length);
      out += String.fromCharCode(c);
    }
    return 'fallback:' + window.btoa(out);
  }

  function fallbackDecrypt(cipherText, key) {
    var k = key || APP_SECRET;
    var raw = cipherText.replace(/^fallback:/, '');
    var decoded = window.atob(raw);
    var out = '';
    for (var i = 0; i < decoded.length; i++) {
      var c = decoded.charCodeAt(i) ^ k.charCodeAt(i % k.length);
      out += String.fromCharCode(c);
    }
    return decodeURIComponent(out);
  }

  var JpCrypto = {
    /**
     * Mã hóa một object / chuỗi dữ liệu thành JSON Envelope bảo mật
     * @param {Object|string} data - Dữ liệu cần mã hóa
     * @param {string} [customSecret] - Khóa tùy chọn
     * @returns {Promise<Object>} JSON Envelope đã mã hóa
     */
    encrypt: async function (data, customSecret) {
      var plainText = typeof data === 'string' ? data : JSON.stringify(data);
      var secret = customSecret || APP_SECRET;

      try {
        if (window.crypto && window.crypto.subtle) {
          var key = await deriveKey(secret);
          var iv = window.crypto.getRandomValues(new Uint8Array(12));
          var enc = new TextEncoder();
          var encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            enc.encode(plainText)
          );

          return {
            version: '2.0-aes-gcm',
            encrypted: true,
            updatedAt: new Date().toISOString(),
            iv: bufferToBase64(iv),
            payload: bufferToBase64(encryptedBuffer),
          };
        }
      } catch (err) {
        console.warn('Web Crypto API error, using fallback encryption:', err);
      }

      return {
        version: '2.0-fallback',
        encrypted: true,
        updatedAt: new Date().toISOString(),
        payload: fallbackEncrypt(plainText, secret),
      };
    },

    /**
     * Giải mã JSON Envelope thành object / chuỗi gốc
     * @param {Object|string} envelope - Dữ liệu đã mã hóa
     * @param {string} [customSecret] - Khóa tùy chọn
     * @returns {Promise<Object|null>} Dữ liệu gốc sau khi giải mã
     */
    decrypt: async function (envelope, customSecret) {
      if (!envelope) return null;

      // Nếu truyền vào chuỗi JSON string, parse trước
      var obj = envelope;
      if (typeof envelope === 'string') {
        try {
          obj = JSON.parse(envelope);
        } catch (e) {
          return null;
        }
      }

      // Nếu dữ liệu chưa bị mã hóa (plain object hoặc mảng thô), trả về trực tiếp
      if (!obj.encrypted && (Array.isArray(obj) || obj.concepts)) {
        return obj.concepts ? obj : { concepts: obj };
      }

      var secret = customSecret || APP_SECRET;

      try {
        if (obj.version === '2.0-aes-gcm' && obj.iv && obj.payload && window.crypto && window.crypto.subtle) {
          var key = await deriveKey(secret);
          var iv = new Uint8Array(base64ToBuffer(obj.iv));
          var payloadBuffer = base64ToBuffer(obj.payload);
          var decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            payloadBuffer
          );
          var dec = new TextDecoder();
          var jsonStr = dec.decode(decryptedBuffer);
          return JSON.parse(jsonStr);
        }

        if (obj.payload) {
          var plainStr = fallbackDecrypt(obj.payload, secret);
          return JSON.parse(plainStr);
        }
      } catch (err) {
        console.error('Giải mã dữ liệu thất bại:', err);
        return null;
      }

      return null;
    },
  };

  window.JpCrypto = JpCrypto;
})(window);
