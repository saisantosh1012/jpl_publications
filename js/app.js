/**
 * JPL Publications - Shared Application Script & Data Layer
 * Connects to Central API Server (/api/publications & /api/pdfs) so all updates
 * made in the Admin Portal are stored in the server DB and visible to EVERY visitor globally.
 */

(function (window) {
  "use strict";

  /* ==================================================================
     1. StorageDB (Offline Backup Cache)
     ================================================================== */
  var StorageDB = {
    dbName: 'jpl_publications_db_v2',
    storeName: 'jpl_store',
    dbPromise: null,

    init: function () {
      if (this.dbPromise) return this.dbPromise;
      var self = this;
      this.dbPromise = new Promise(function (resolve) {
        if (!window.indexedDB) { resolve(null); return; }
        try {
          var req = window.indexedDB.open(self.dbName, 1);
          req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(self.storeName)) {
              db.createObjectStore(self.storeName);
            }
          };
          req.onsuccess = function (e) { resolve(e.target.result); };
          req.onerror = function () { resolve(null); };
        } catch (err) { resolve(null); }
      });
      return this.dbPromise;
    },

    get: async function (key) {
      try {
        var db = await this.init();
        if (db) {
          var self = this;
          var val = await new Promise(function (resolve) {
            var tx = db.transaction(self.storeName, 'readonly');
            var store = tx.objectStore(self.storeName);
            var req = store.get(key);
            req.onsuccess = function () { resolve(req.result !== undefined ? req.result : null); };
            req.onerror = function () { resolve(null); };
          });
          if (val !== null) return val;
        }
      } catch (err) { }
      try { return window.localStorage.getItem(key); } catch (e) { return null; }
    },

    set: async function (key, value) {
      try {
        var db = await this.init();
        if (db) {
          var self = this;
          await new Promise(function (resolve) {
            var tx = db.transaction(self.storeName, 'readwrite');
            var store = tx.objectStore(self.storeName);
            var req = store.put(value, key);
            req.onsuccess = function () { resolve(true); };
            req.onerror = function () { resolve(false); };
          });
        }
      } catch (err) { }
      try { window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { }
      return true;
    },

    delete: async function (key) {
      try {
        var db = await this.init();
        if (db) {
          var self = this;
          await new Promise(function (resolve) {
            var tx = db.transaction(self.storeName, 'readwrite');
            var store = tx.objectStore(self.storeName);
            var req = store.delete(key);
            req.onsuccess = function () { resolve(true); };
            req.onerror = function () { resolve(false); };
          });
        }
      } catch (err) { }
      try { window.localStorage.removeItem(key); } catch (e) { }
      return true;
    }
  };

  window.StorageDB = StorageDB;

  /* ==================================================================
     2. Central API & Data Store Integration
     ================================================================== */
  var STORAGE_KEY = 'jpl_publications_v1';
  var PDF_KEY_PREFIX = 'jpl_pdf_v1:';
  var API_BASE = '/api/publications';
  var pubCache = [];

  function seedIfEmpty() {
    return [
      {
        id: 'seed-1',
        title: 'Advances in Sustainable Materials for Civil Infrastructure',
        authors: 'Dr. A. Karthik, R. Menon',
        date: '2026-07-14',
        category: 'Journal',
        description: 'A peer-reviewed study examining low-carbon composite materials for long-span infrastructure, with lifecycle cost modelling across three climates.',
        link: '',
        hasPdf: false,
        pdfName: ''
      },
      {
        id: 'seed-2',
        title: 'Adaptive Signal Filtering Method for Low-Power IoT Sensors',
        authors: 'Mr. V. Santhosh Kumar',
        date: '2026-06-02',
        category: 'Patent',
        description: 'Patent publication documenting a novel adaptive filtering circuit that reduces power draw in distributed sensor networks by up to 34%.',
        link: '',
        hasPdf: false,
        pdfName: ''
      },
      {
        id: 'seed-3',
        title: 'Interdisciplinary Approaches to Public Health Policy Design',
        authors: 'Dr. Satyanand Singh',
        date: '2026-05-20',
        category: 'Ph.D. Thesis',
        description: 'A doctoral thesis synthesizing epidemiology, behavioural economics and policy science to model community health interventions.',
        link: '',
        hasPdf: false,
        pdfName: ''
      }
    ];
  }

  async function loadPublications() {
    try {
      var res = await fetch(API_BASE + '?t=' + Date.now());
      if (res.ok) {
        var json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          pubCache = json.data;
          await StorageDB.set(STORAGE_KEY, JSON.stringify(pubCache));
          return pubCache;
        }
      }
    } catch (err) {
      console.warn('Central API fetch fallback to local cache:', err);
    }

    // Fallback to local cache if offline or standalone static
    try {
      var raw = await StorageDB.get(STORAGE_KEY);
      if (raw) {
        pubCache = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } else {
        pubCache = seedIfEmpty();
      }
    } catch (e) {
      pubCache = seedIfEmpty();
    }
    return pubCache;
  }

  async function savePublicationCentral(entry, pdfDataUrl, removePdf) {
    try {
      var payload = Object.assign({}, entry);
      if (pdfDataUrl) payload.pdfDataUrl = pdfDataUrl;
      if (removePdf) payload.removePdf = true;

      var res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        var json = await res.json();
        if (json && json.success && json.entry) {
          // Update cache
          var idx = pubCache.findIndex(function (p) { return p.id === json.entry.id; });
          if (idx > -1) {
            pubCache[idx] = json.entry;
          } else {
            pubCache.unshift(json.entry);
          }
          await StorageDB.set(STORAGE_KEY, JSON.stringify(pubCache));
          return true;
        }
      }
    } catch (err) {
      console.warn('Central API save error, saving locally:', err);
    }

    // Backup local save if API unreachable
    var idx2 = pubCache.findIndex(function (p) { return p.id === entry.id; });
    if (idx2 > -1) { pubCache[idx2] = entry; } else { pubCache.unshift(entry); }
    if (pdfDataUrl) {
      await StorageDB.set(PDF_KEY_PREFIX + entry.id, pdfDataUrl);
      entry.hasPdf = true;
    }
    await StorageDB.set(STORAGE_KEY, JSON.stringify(pubCache));
    return true;
  }

  async function deletePublicationCentral(id) {
    try {
      var res = await fetch('/api/publications/' + id, { method: 'DELETE' });
      if (res.ok) {
        var idx = pubCache.findIndex(function (p) { return p.id === id; });
        if (idx > -1) pubCache.splice(idx, 1);
        await StorageDB.delete(PDF_KEY_PREFIX + id);
        await StorageDB.set(STORAGE_KEY, JSON.stringify(pubCache));
        return true;
      }
    } catch (err) {
      console.warn('Central API delete error:', err);
    }

    var idx2 = pubCache.findIndex(function (p) { return p.id === id; });
    if (idx2 > -1) pubCache.splice(idx2, 1);
    await StorageDB.delete(PDF_KEY_PREFIX + id);
    await StorageDB.set(STORAGE_KEY, JSON.stringify(pubCache));
    return true;
  }

  window.JPLData = {
    loadPublications: loadPublications,
    savePublicationCentral: savePublicationCentral,
    deletePublicationCentral: deletePublicationCentral,
    getCache: function () { return pubCache; },
    setCache: function (arr) { pubCache = arr; },
    STORAGE_KEY: STORAGE_KEY,
    PDF_KEY_PREFIX: PDF_KEY_PREFIX
  };

  /* ==================================================================
     3. Shared UI Utilities & Observers
     ================================================================== */
  window.addEventListener('load', function () {
    var loader = document.getElementById('loader');
    if (loader) {
      setTimeout(function () { loader.classList.add('hide'); }, 400);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    var yearNow = document.getElementById('yearNow');
    if (yearNow) yearNow.textContent = new Date().getFullYear();

    var headerEl = document.getElementById('siteHeader');
    if (headerEl) {
      window.addEventListener('scroll', function () {
        headerEl.classList.toggle('scrolled', window.scrollY > 12);
      });
    }

    var burger = document.getElementById('burgerBtn');
    var navTabs = document.getElementById('navTabs');
    var scrim = document.getElementById('navScrim');
    if (burger && navTabs && scrim) {
      burger.addEventListener('click', function () {
        navTabs.classList.toggle('open');
        scrim.classList.toggle('show');
      });
      scrim.addEventListener('click', function () {
        navTabs.classList.remove('open');
        scrim.classList.remove('show');
      });
    }

    var consultTrigger = document.getElementById('consultTrigger');
    if (consultTrigger) {
      consultTrigger.addEventListener('click', function (e) {
        if (window.innerWidth <= 760) {
          e.preventDefault();
          var dropdown = document.getElementById('consultDropdown');
          if (dropdown) dropdown.classList.toggle('open');
        }
      });
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) en.target.classList.add('visible');
      });
    }, { threshold: 0.12 });

    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

    var countersDone = false;
    var statsGridEl = document.querySelector('.stats-grid');
    if (statsGridEl) {
      var counterIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !countersDone) {
            countersDone = true;
            document.querySelectorAll('.counter').forEach(function (el) {
              var target = parseInt(el.getAttribute('data-target'), 10);
              var suffix = el.getAttribute('data-suffix') || '';
              var dur = 1400, t0 = null;
              function step(ts) {
                if (!t0) t0 = ts;
                var p = Math.min((ts - t0) / dur, 1);
                var eased = 1 - Math.pow(1 - p, 3);
                el.textContent = Math.round(eased * target) + suffix;
                if (p < 1) requestAnimationFrame(step);
              }
              requestAnimationFrame(step);
            });
            counterIo.disconnect();
          }
        });
      }, { threshold: 0.3 });
      counterIo.observe(statsGridEl);
    }

    document.querySelectorAll('.faq-q').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = this.closest('.faq-item');
        var wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function (i) { i.classList.remove('open'); });
        if (!wasOpen) item.classList.add('open');
      });
    });

    var pdfModal = document.getElementById('pdfModal');
    var pdfCloseBtn = document.getElementById('pdfCloseBtn');
    if (pdfModal) {
      if (pdfCloseBtn) pdfCloseBtn.addEventListener('click', closePdfModal);
      pdfModal.addEventListener('click', function (e) {
        if (e.target === pdfModal) closePdfModal();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && pdfModal.classList.contains('show')) closePdfModal();
      });
    }
  });

  /* ==================================================================
     4. Helpers & PDF Viewer Integration
     ================================================================== */
  var toastTimer;
  window.toast = function (msg) {
    var toastEl = document.getElementById('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2800);
  };

  window.fmtDate = function (iso) {
    try {
      var d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return iso; }
  };

  window.escapeHtml = function (str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  };

  window.openPdfModal = async function (id, title) {
    var pdfModal = document.getElementById('pdfModal');
    var pdfFrame = document.getElementById('pdfFrame');
    var pdfLoading = document.getElementById('pdfLoading');
    var pdfDownloadBtn = document.getElementById('pdfDownloadBtn');
    var pdfModalTitle = document.getElementById('pdfModalTitle');

    if (!pdfModal || !pdfFrame || !pdfLoading) return;

    if (pdfModalTitle) pdfModalTitle.textContent = title || 'Publication PDF';
    pdfFrame.style.display = 'none';
    pdfFrame.src = 'about:blank';
    pdfLoading.style.display = 'flex';
    pdfModal.classList.add('show');

    var pubEntry = JPLData.getCache().find(function (p) { return p.id === id; });
    var pdfUrl = (pubEntry && pubEntry.pdfUrl) || ('/api/pdfs/' + id);

    // 1. Try server API endpoint directly
    try {
      var checkRes = await fetch(pdfUrl, { method: 'HEAD' });
      if (checkRes.ok) {
        pdfFrame.src = pdfUrl;
        if (pdfDownloadBtn) {
          pdfDownloadBtn.href = pdfUrl;
          pdfDownloadBtn.setAttribute('download', (pubEntry && pubEntry.pdfName) || 'publication.pdf');
        }
        pdfFrame.style.display = 'block';
        pdfLoading.style.display = 'none';
        return;
      }
    } catch (err) { }

    // 2. Fallback to StorageDB local cache
    try {
      var pdfData = await StorageDB.get(PDF_KEY_PREFIX + id);
      if (pdfData) {
        pdfFrame.src = pdfData;
        if (pdfDownloadBtn) {
          pdfDownloadBtn.href = pdfData;
          pdfDownloadBtn.setAttribute('download', (pubEntry && pubEntry.pdfName) || 'publication.pdf');
        }
        pdfFrame.style.display = 'block';
        pdfLoading.style.display = 'none';
      } else {
        pdfLoading.querySelector('span:last-child').textContent = 'PDF document not found.';
      }
    } catch (err) {
      pdfLoading.querySelector('span:last-child').textContent = 'Could not load PDF document.';
    }
  };

  window.closePdfModal = function () {
    var pdfModal = document.getElementById('pdfModal');
    var pdfFrame = document.getElementById('pdfFrame');
    var pdfLoading = document.getElementById('pdfLoading');
    if (pdfModal) pdfModal.classList.remove('show');
    if (pdfFrame) setTimeout(function () { pdfFrame.src = 'about:blank'; }, 300);
    if (pdfLoading) {
      var span = pdfLoading.querySelector('span:last-child');
      if (span) span.textContent = 'Loading document…';
    }
  };

  window.pubCardHtml = function (p, idx) {
    var linkHtml = p.link ? '<a class="pub-link" href="' + (/^https?:\/\//.test(p.link) ? escapeHtml(p.link) : 'https://' + escapeHtml(p.link)) + '" target="_blank" rel="noopener">Read reference <svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg></a>' : '';
    var pdfHtml = p.hasPdf ? '<button class="pdf-view-btn view-pdf-btn" data-id="' + p.id + '" data-title="' + escapeHtml(p.title) + '"><svg viewBox="0 0 24 24"><path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4z"/><path d="M4 17a3 3 0 013-3h11"/></svg> View full PDF</button>' : '';
    var badge = p.hasPdf ? '<span class="pdf-badge"><svg viewBox="0 0 24 24"><path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4z"/></svg> PDF</span>' : '';
    return '' +
      '<article class="pub-card" style="animation-delay:' + ((idx || 0) * 0.04) + 's;">' +
        '<div class="pub-top"><span class="pub-tag">' + escapeHtml(p.category) + '</span><span class="pub-date">' + fmtDate(p.date) + '</span></div>' +
        '<h3>' + escapeHtml(p.title) + '</h3>' +
        '<span class="pub-authors">' + escapeHtml(p.authors) + '</span>' +
        (badge ? '<div>' + badge + '</div>' : '') +
        '<p class="pub-desc">' + escapeHtml(p.description) + '</p>' +
        '<div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;">' + linkHtml + pdfHtml + '</div>' +
      '</article>';
  };

  window.bindPdfButtons = function () {
    document.querySelectorAll('.view-pdf-btn').forEach(function (btn) {
      btn.onclick = function () {
        openPdfModal(this.getAttribute('data-id'), this.getAttribute('data-title'));
      };
    });
  };

})(window);
