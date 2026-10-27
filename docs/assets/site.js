/* whatsapp-desktop landing page.
 * Orthotect Architecture: 100% CSS Logical Properties | FSM Completeness | True BiDi
 */
(function () {
  "use strict";

  var REPO = "seotarek/whatsapp-desktop";
  var API = "https://api.github.com/repos/" + REPO + "/releases/latest";
  var RELEASES = "https://github.com/" + REPO + "/releases";
  var CACHE_KEY = "wad:latest";
  var CACHE_MS = 30 * 60 * 1000;

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function humanSize(bytes) {
    if (!bytes) return "";
    var mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
  }

  function humanDate(iso, isArabic) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var locale = isArabic ? "ar-EG" : "en-GB";
    return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  }

  /* ------------------------------------------------------------- i18n -- */

  var I18N = {
    en: {
      "nav.skip": "Skip to content",
      "nav.features": "Features",
      "nav.install": "Install",
      "nav.downloads": "Downloads",
      "nav.update": "Update",
      "nav.configure": "Configure",
      "nav.remove": "Remove",
      "nav.build": "Build",
      "nav.report": "Report",
      "hero.eyebrow": "Free & Open Source · Fedora · Debian · Ubuntu · Arch",
      "hero.title": "WhatsApp for Linux",
      "hero.lead": "A real desktop app for the WhatsApp you already use. It sits in the tray and notifies you the moment a message lands, takes voice and video calls with screen sharing, and draws your chats in the exact font and size you want. Zero cloud relays, zero account modifications.",
      "hero.ctaDownload": "Download",
      "hero.ctaInstall": "Install from terminal",
      "hero.fact1Title": "Independent Runtime",
      "hero.fact1Desc": "Carries its own hardened Chromium engine.",
      "hero.fact2Title": "Cryptographically Signed",
      "hero.fact2Desc": "Verifiable GPG signature from Shinux repo.",
      "hero.fact3Title": "Native Updates",
      "hero.fact3Desc": "Upgrades with dnf, apt or pacman.",
      "feat.title": "What you get",
      "feat.subtitle": "WhatsApp engineered to feel completely native to your Linux desktop environment.",
      "feat.f1Title": "A notification for every message",
      "feat.f1Desc": "Not one per chat — one per message, with who wrote it, their avatar and what they said. Click it and that conversation opens immediately. Read it on your phone and the banner dismisses on its own.",
      "feat.f2Title": "Voice and video calls",
      "feat.f2Desc": "Call or answer directly from your desktop. Camera and microphone work out of the box with zero permissions prompts. Share your whole screen or a single window during calls.",
      "feat.f3Title": "A font for each alphabet",
      "feat.f3Desc": "Independent family, size, and weight controls for Latin and Arabic scripts. Give Arabic the typography it deserves without distorting your Latin typeface, or vice versa.",
      "feat.f4Title": "Arabic that reads like Arabic",
      "feat.f4Desc": "Every line derives direction from its own first character. Arabic aligns right and English aligns left in the same bubble, group conversations, and notifications. Full BiDi perfection.",
      "feat.f5Title": "Lives in the system tray",
      "feat.f5Desc": "Closing the window keeps the application connected in the background. Starts minimized on login with desktop environment indicators for incoming unread messages.",
      "feat.f6Title": "Dark, light, or follows the desktop",
      "feat.f6Desc": "Dedicated settings window (Ctrl+,) supporting system theme matching, force dark, or light mode. Configures startup, tray actions, zoom level, and audio tones without text files.",
      "feat.f7Title": "Smoother than the browser",
      "feat.f7Desc": "GPU-accelerated scrolling ensures lengthy message lists never stutter. Smooth panel animations, unified conversation resizing, and instant pinned-message navigation.",
      "feat.f8Title": "Daily release notifications",
      "feat.f8Desc": "Silently checks GitHub releases once per day. When a new version is released, the tray announces it by name. Never auto-installs behind your back — your package manager handles it.",
      "feat.f9Title": "Your account is untouched",
      "feat.f9Desc": "Runs WhatsApp official web application inside an isolated Electron container. No intermediate servers, no altered protocols, and no unauthorized modifications. Connects via standard QR scan.",
      "showcase.settingsTitle": "Everything is an instant switch",
      "showcase.settingsDesc": "Access with Ctrl+, or through the system tray. Every change applies the instant you click it with zero restarts needed.",
      "showcase.fontsTitle": "A font for English, and a different one for Arabic",
      "showcase.fontsDesc": "Most chat applications enforce a single typeface, compromising script aesthetics. Our dedicated typography engine isolates scripts by character unicode range.",
      "showcase.aboutTitle": "Continuous integrity & updates",
      "showcase.aboutDesc": "The About WhatsApp dialog shows the current installed version and offers instant checks against official GitHub releases. The client never runs clandestine background installers — your native package manager remains in full control.",
      "install.title": "Install",
      "install.subtitle": "Choose your Linux distribution and execute the terminal commands. Packages are signed and maintained via the Shinux repository.",
      "dl.title": "Downloads",
      "dl.subtitle": "Direct binary artifacts from latest GitHub release.",
      "up.title": "Update",
      "up.subtitle": "The client relies on standard system package managers. Execute these commands to upgrade WhatsApp individually.",
      "conf.title": "Configure",
      "conf.subtitle": "Every setting is readable and modifiable in plain text format: ~/.config/whatsapp-desktop/whatsapp-desktop.conf.",
      "rem.title": "Removing it",
      "rem.subtitle": "Clean removal instructions for both the package and the Shinux repository configuration.",
      "build.title": "Build it yourself",
      "build.subtitle": "Complete transparency: inspect the source code, verify dependencies, or compile your own standalone release.",
      "rep.title": "Report a bug or feature request",
      "rep.subtitle": "All development and feedback are tracked publicly via the official GitHub issue tracker."
    },
    ar: {
      "nav.skip": "تخطي إلى المحتوى",
      "nav.features": "المميزات",
      "nav.install": "التثبيت",
      "nav.downloads": "التحميل",
      "nav.update": "التحديث",
      "nav.configure": "الإعدادات",
      "nav.remove": "إلغاء التثبيت",
      "nav.build": "البناء",
      "nav.report": "الإبلاغ",
      "hero.eyebrow": "حر ومفتوح المصدر · فيدورا · دبيان · أوبونتو · آرتش",
      "hero.title": "واتساب لأنظمة لينكس",
      "hero.lead": "تطبيق سطح مكتب متكامل لتطبيق واتساب الذي تستخدمه بالفعل. يعمل في شريط المهام (Tray) ويُشعرك فور وصول أي رسالة، ويدعم المكالمات الصوتية والمرئية مع مشاركة الشاشة، ويعرض محادثاتك بالخط والحجم الذي تفضله بدقة. بدون خوادم وسيطة أو تعديلات على الحساب.",
      "hero.ctaDownload": "تحميل أحدث إصدار",
      "hero.ctaInstall": "التثبيت عبر الطرفية",
      "hero.fact1Title": "بيئة تشغيل مستقلة",
      "hero.fact1Desc": "يحمل محرك كروميوم المحمي الخاص به بشكل مستقل.",
      "hero.fact2Title": "موقّع رقمياً",
      "hero.fact2Desc": "موقّع بمفاتيح GPG رسمية وموثوقة من مستودع Shinux.",
      "hero.fact3Title": "تحديثات مع النظام",
      "hero.fact3Desc": "يترقى مباشرة مع أدوات dnf أو apt أو pacman.",
      "feat.title": "ما يقدمه التطبيق",
      "feat.subtitle": "واتساب مهندس ليعمل باندماج كامل كأحد تطبيقات سطح مكتب لينكس الأصيلة.",
      "feat.f1Title": "إشعار مستقل لكل رسالة",
      "feat.f1Desc": "إشعار لكل رسالة واردة بدلاً من إشعار واحد للمحادثة، يوضح المرسل وصورته ونص الرسالة. النقر عليه يفتح المحادثة فوراً، وقراءتها من الهاتف تخفي الإشعار تلقائياً.",
      "feat.f2Title": "مكالمات صوت وفيديو",
      "feat.f2Desc": "اتصل أو رد على المكالمات مباشرة من جهازك — تعمل الكاميرا والميكروفون فوراً بدون أذونات مسبقة، مع إمكانية مشاركة الشاشة بالكامل أو نافذة معينة.",
      "feat.f3Title": "خط مخصص لكل أبجدية",
      "feat.f3Desc": "تحكم مستقل في نوع الخط وحجمه ووزنه للنصوص العربية واللاتينية. امنح الخط العربي الجمالية التي يستحقها دون التأثير على خط اللغة الإنجليزية أو العكس.",
      "feat.f4Title": "لغة عربية تُقرأ كما يجب",
      "feat.f4Desc": "يحدد كل سطر اتجاهه وفقاً لأول كلمة فيه، فتستقر العربية على اليمين والإنجليزية على اليسار داخل الرسالة الواحدة وفي المجموعات مع دعم اتجاهي كامل (BiDi).",
      "feat.f5Title": "استقرار دائم في شريط المهام",
      "feat.f5Desc": "إغلاق النافذة يبقي التطبيق قيد التشغيل متصلاً في الخلفية دون تفويت أي رسائل، مع إمكانية البدء تلقائياً مع تشغيل الجهاز وتنبيهك بوجود رسائل غير مقروءة.",
      "feat.f6Title": "وضع داكن، فاتح، أو مطابق للنظام",
      "feat.f6Desc": "نافذة إعدادات متكاملة (Ctrl+,) تتيح التبديل بين سمة النظام والوضع الداكن والفاتح، والتحكم في الإقلاع وسلوك الإغلاق وحجم التكبير بدون تحرير أي ملفات نصية.",
      "feat.f7Title": "سلاسة تتفوق على المتصفح",
      "feat.f7Desc": "تمرير معزز ببطاقة الرسوميات (GPU) يمنع أي تقطيع أثناء تصفح المحادثات الطويلة، مع انسيابية تامة في تحريك الألواح والانتقال الفوري للرسائل المثبتة والمقتبسة.",
      "feat.f8Title": "تنبيهات تلقائية للإصدارات الجديدة",
      "feat.f8Desc": "يفحص مستودع GitHub يومياً في الخلفية للإصدارات الأحدث، ويسميها في قائمة شريط المهام فور توفرها دون تثبيت أي شيء دون إذنك.",
      "feat.f9Title": "حسابك وبياناتك في أمان تام",
      "feat.f9Desc": "يعمل التطبيق على تشغيل واجهة واتساب ويب الرسمية داخل إلكترون دون أي خوادم وسيطة أو بروتوكولات معدلة، ويرتبط بهاتفك بالطريقة الرسمية تماماً.",
      "showcase.settingsTitle": "كل إعداد بنقرة زر فورية",
      "showcase.settingsDesc": "نافذة واحدة عبر Ctrl+, أو من شريط المهام تطبق كافة التغييرات في نفس اللحظة دون الحاجة لإعادة التشغيل.",
      "showcase.fontsTitle": "خط مخصص للإنجليزية، وخط مستقل للعربية",
      "showcase.fontsDesc": "معظم التطبيقات تفرض خطاً موحداً يشوه أحد الحرفين، بينما يوفر تطبيقنا محركين منفصلين تماماً للخطوط حسب النطاق اللغوي للحروف.",
      "showcase.aboutTitle": "فحص ومتابعة مستمرة للتحديثات",
      "showcase.aboutDesc": "تعرض نافذة حول واتساب الإصدار الحالي وتمكنك من التحقق من التحديثات الرسمية بنقرة واحدة دون برامج تثبيت خفية.",
      "install.title": "التثبيت",
      "install.subtitle": "اختر توزيعتك وانسخ الأوامر؛ الحزم موثقة وموقعة وتأتي من مستودع Shinux المعتمد.",
      "dl.title": "التحميل المباشر",
      "dl.subtitle": "حزم مبنية مباشرة عبر خطوط الإنتاج والتحقق التلقائي (CI) من أحدث وسوم Git.",
      "up.title": "التحديث",
      "up.subtitle": "يتم التحديث عبر مدير الحزم المعتمد في توزيعتك بشكل متزامن مع باقي النظام.",
      "conf.title": "التخصيص المتقدم",
      "conf.subtitle": "كافة الإعدادات متاحة أيضاً كملف تكوين نصي بسيط يمكن تحريره مباشرة: ~/.config/whatsapp-desktop/whatsapp-desktop.conf.",
      "rem.title": "إلغاء التثبيت",
      "rem.subtitle": "خطوات واضحة وسريعة لإزالة التطبيق والمستودع بالكامل دون التأثير على هاتفك.",
      "build.title": "البناء من المصدر",
      "build.subtitle": "الشفافية الكاملة: يمكنك فحص الكود البرمجي وبناء الحزم بنفسك باستخدام Node وMake فقط.",
      "rep.title": "الإبلاغ عن الأخطاء وطلب الميزات",
      "rep.subtitle": "تتبع المشاكل والاقتراحات مفتوح للجميع عبر مستودع GitHub الرسمي."
    }
  };

  /* ------------------------------------------------------------- theme FSM -- */

  var THEMES = ["dark", "light", "contrast"];

  function initTheme() {
    var btn = document.getElementById("themeToggleBtn");
    var label = document.getElementById("themeBtnText");
    if (!btn || !label) return;

    function applyTheme(name) {
      document.documentElement.setAttribute("data-theme", name);
      try { localStorage.setItem("ortho_theme", name); } catch (e) {}
      var isAr = document.documentElement.getAttribute("lang") === "ar";
      var names = {
        dark: isAr ? "داكن" : "Dark",
        light: isAr ? "فاتح" : "Light",
        contrast: isAr ? "تباين عالي" : "Contrast"
      };
      label.textContent = names[name] || name;
    }

    var current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current);

    btn.addEventListener("click", function () {
      var idx = THEMES.indexOf(document.documentElement.getAttribute("data-theme") || "dark");
      var next = THEMES[(idx + 1) % THEMES.length];
      applyTheme(next);
    });
  }

  /* ------------------------------------------------------------- bidi FSM -- */

  function initBiDi() {
    var btn = document.getElementById("bidiToggleBtn");
    var label = document.getElementById("langBtnText");
    if (!btn || !label) return;

    function applyLang(lang) {
      var isAr = (lang === "ar");
      document.documentElement.setAttribute("lang", isAr ? "ar" : "en");
      document.documentElement.setAttribute("dir", isAr ? "rtl" : "ltr");
      try { localStorage.setItem("ortho_lang", isAr ? "ar" : "en"); } catch (e) {}
      label.textContent = isAr ? "English" : "العربية";

      // Apply translations
      var dict = I18N[isAr ? "ar" : "en"];
      if (dict) {
        $$("[data-i18n]").forEach(function (el) {
          var k = el.getAttribute("data-i18n");
          if (dict[k]) el.textContent = dict[k];
        });
      }

      // Update theme toggle label
      var curTheme = document.documentElement.getAttribute("data-theme") || "dark";
      var themeLabel = document.getElementById("themeBtnText");
      if (themeLabel) {
        var names = {
          dark: isAr ? "داكن" : "Dark",
          light: isAr ? "فاتح" : "Light",
          contrast: isAr ? "تباين عالي" : "Contrast"
        };
        themeLabel.textContent = names[curTheme] || curTheme;
      }
    }

    var initialLang = document.documentElement.getAttribute("lang") || "en";
    applyLang(initialLang);

    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("lang") || "en";
      var next = (cur === "ar") ? "en" : "ar";
      applyLang(next);
    });
  }

  /* ------------------------------------------------- github latest release -- */

  function cached() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var box = JSON.parse(raw);
      return Date.now() - box.at < CACHE_MS ? box.data : null;
    } catch (e) { return null; }
  }

  function remember(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) {}
  }

  function applyRelease(release) {
    var tag = release.tag_name || "";
    var version = tag.replace(/^v/, "");
    var assets = release.assets || [];
    var isAr = document.documentElement.getAttribute("lang") === "ar";

    $$("[data-tag]").forEach(function (el) { el.textContent = tag; });
    $$("[data-version]").forEach(function (el) { el.textContent = version; });

    var when = humanDate(release.published_at, isAr);
    $$("[data-release-date]").forEach(function (el) {
      el.textContent = when ? (isAr ? "، نُشر في " + when : ", published " + when) : "";
    });

    $$("[data-assets] .dl-card").forEach(function (card) {
      var suffix = card.getAttribute("data-match");
      var skip = card.getAttribute("data-skip");
      var hit = null;

      for (var i = 0; i < assets.length; i++) {
        var name = assets[i].name;
        if (name.slice(-suffix.length) !== suffix) continue;
        if (skip && name.indexOf(skip) !== -1) continue;
        hit = assets[i];
        break;
      }
      if (!hit) return;

      card.href = hit.browser_download_url;
      var nameEl = card.querySelector("[data-name]");
      var sizeEl = card.querySelector("[data-size]");
      var sumEl = card.querySelector("[data-digest]");
      if (nameEl) nameEl.textContent = hit.name;
      if (sizeEl) sizeEl.textContent = humanSize(hit.size);
      if (sumEl && hit.digest) {
        sumEl.textContent = "sha256 " + hit.digest.replace(/^sha256:/, "").slice(0, 16) + "…";
        sumEl.title = hit.digest;
      }
    });

    var sums = assets.filter(function (a) { return a.name === "SHA256SUMS"; })[0];
    if (sums) {
      $$("[data-sums-url]").forEach(function (el) { el.textContent = sums.browser_download_url; });
    }
  }

  function loadRelease() {
    var hot = cached();
    if (hot) { applyRelease(hot); return; }

    fetch(API, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) { remember(data); applyRelease(data); })
      .catch(function () {
        $$("[data-tag]").forEach(function (el) {
          if (el.textContent === "the latest release") el.textContent = "releases";
        });
      });
  }

  /* ------------------------------------------------------------- tabs FSM -- */

  function initTabs() {
    $$([role=tablist]).forEach(function (list) {
      var tabs = $$([role=tab], list);

      function select(tab) {
        tabs.forEach(function (t) {
          var on = (t === tab);
          t.setAttribute("aria-selected", on ? "true" : "false");
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
        });
      }

      tabs.forEach(function (tab, i) {
        tab.tabIndex = (tab.getAttribute("aria-selected") === "true") ? 0 : -1;
        tab.addEventListener("click", function () { select(tab); });
        tab.addEventListener("keydown", function (e) {
          var isRtl = document.documentElement.getAttribute("dir") === "rtl";
          var forwardKey = isRtl ? "ArrowLeft" : "ArrowRight";
          var backKey = isRtl ? "ArrowRight" : "ArrowLeft";

          var step = (e.key === forwardKey) ? 1 : (e.key === backKey) ? -1 : 0;
          if (!step) {
            if (e.key === "Home") {
              e.preventDefault();
              select(tabs[0]);
              tabs[0].focus();
            } else if (e.key === "End") {
              e.preventDefault();
              select(tabs[tabs.length - 1]);
              tabs[tabs.length - 1].focus();
            }
            return;
          }
          e.preventDefault();
          var next = tabs[(i + step + tabs.length) % tabs.length];
          select(next);
          next.focus();
        });
      });
    });
  }

  /* ------------------------------------------------------ copy buttons FSM -- */

  var COPY_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  var OK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';

  function initCopy() {
    $$("pre:not(.term-body)").forEach(function (pre) {
      var wrap = document.createElement("div");
      wrap.className = "codewrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      var isAr = document.documentElement.getAttribute("lang") === "ar";
      btn.innerHTML = COPY_ICON + "<span>" + (isAr ? "نسخ" : "Copy") + "</span>";
      btn.setAttribute("aria-label", isAr ? "نسخ إلى الحافظة" : "Copy to clipboard");
      wrap.appendChild(btn);

      // Logical property paddingInlineEnd calculation to prevent text underlap
      requestAnimationFrame(function () {
        var room = btn.offsetWidth;
        if (room) pre.style.paddingInlineEnd = (room + 20) + "px";
      });

      var isLocked = false; // Race condition lock
      btn.addEventListener("click", function () {
        if (isLocked) return;
        isLocked = true;

        var text = (pre.textContent || "").replace(/\s+$/, "");
        var finish = function (ok) {
          var ar = document.documentElement.getAttribute("lang") === "ar";
          btn.className = "copy-btn " + (ok ? "copied" : "error");
          btn.innerHTML = (ok ? OK_ICON : COPY_ICON) +
            "<span>" + (ok ? (ar ? "تم النسخ" : "Copied") : (ar ? "اضغط Ctrl+C" : "Press Ctrl+C")) + "</span>";

          setTimeout(function () {
            btn.className = "copy-btn";
            btn.innerHTML = COPY_ICON + "<span>" + (ar ? "نسخ" : "Copy") + "</span>";
            isLocked = false;
          }, 1800);
        };

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { finish(false); });
        } else {
          try {
            var range = document.createRange();
            range.selectNodeContents(pre);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("copy");
            sel.removeAllRanges();
            finish(true);
          } catch (e) {
            finish(false);
          }
        }
      });
    });
  }

  /* ------------------------------------------------------- mobile drawer -- */

  function initMobileDrawer() {
    var btn = document.getElementById("mobileMenuBtn");
    var drawer = document.getElementById("mobileDrawer");
    var backdrop = document.getElementById("mobileDrawerBackdrop");
    var closeBtn = document.getElementById("mobileDrawerCloseBtn");
    if (!btn || !drawer) return;

    function openDrawer() {
      drawer.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      drawer.setAttribute("aria-hidden", "false");
    }

    function closeDrawer() {
      drawer.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      drawer.setAttribute("aria-hidden", "true");
    }

    btn.addEventListener("click", openDrawer);
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    if (backdrop) backdrop.addEventListener("click", closeDrawer);

    $$(".mobile-nav-links a").forEach(function (a) {
      a.addEventListener("click", closeDrawer);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawer.classList.contains("open")) {
        closeDrawer();
      }
    });
  }

  /* ---------------------------------------------------- nav active marker -- */

  function initNavObserver() {
    var links = $$(".topnav a");
    if (!links.length || !("IntersectionObserver" in window)) return;

    var byId = {};
    links.forEach(function (a) {
      var href = a.getAttribute("href");
      if (href && href.startsWith("#")) byId[href.slice(1)] = a;
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var link = byId[entry.target.id];
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("active"); });
          link.classList.add("active");
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });

    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) observer.observe(sec);
    });
  }

  /* ----------------------------------------------------------------- init -- */

  $$("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  initTheme();
  initBiDi();
  initTabs();
  initCopy();
  initMobileDrawer();
  initNavObserver();
  loadRelease();
})();
