/* ==========================================================================
   Hero: scroll-scrubbable intro + scroll-linked handoff to white.

   The intro is one playhead (t, in ms). It plays forward on its own at normal
   speed. Scrolling down pushes it forward faster; scrolling up pulls it back
   (the animation reverses). When it reaches the end the page unlocks and the
   normal scroll handoff takes over. Scrolling up at the very top of the page
   re-enters the intro and rewinds it.

   render(t) draws every element for any t, so the intro can run in either
   direction. No libraries.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Intro timings, in ms on the playhead (0 = video can play) ----------
     Change these to retime the intro. Each line fades in over FADE_IN, holds,
     and finishes fading out at its `out` time. */
  var T = {
    videoFade: 600,                 // video fades up from the poster
    line1: { in: 600,  out: 2300 }, // "You can't be everywhere."   words appear one by one from `in`
    line2: { in: 2400, out: 4000 }, // "But your agents can."       the whole sentence fades out by `out`
    WORD_STAGGER: 150,              // ms between one word appearing and the next
    WORD_FADE: 480,                 // ms each word takes to ease in
    logoIn: 4100,                   // logo scales 0.9 → 1 at centre
    logoInDur: 600,
    taglineIn: 4500,                // tagline words start easing in under the logo
    TAG_STAGGER: 110,               // ms between tagline words (13 words → fully in about 1.8 s later)
    TAG_FADE: 520,                  // ms each tagline word takes to ease in
    GLOW_DELAY: 240,                // ms after a word starts easing in that its flicker begins (as it becomes solid)
    GLOW_DUR: 700,                  // ms of glow flicker on each tagline word as it appears
    GLOW_PEAK: 0.55,                // glow strength at its brightest (0..1); subtle by design
    LOAD_CURVE: 3.2,                // loading ring: how front-loaded it is (higher = faster start, longer slow finish)
    LOAD_FADE_OUT: 400,             // ...completes exactly at the handoff, then fades out
    handoff: 8800,                  // 2.5 s after the tagline is fully in, the logo glides to the nav and the nav arrives
    glide: 900,                     // logo glide duration
    FADE_IN: 500,
    FADE_OUT: 400,
    RISE: 20,                       // px the intro lines rise while fading in
    LOGO_CENTER_H: 120,             // logo height at centre (capped at 20% of the screen width)
    LOGO_TEXT_CENTRE: 0.604,        // the "crossframe" lettering's centre across fulllogo4.png (0.5 = the image's centre);
                                    // at centre the logo shifts left so the lettering, not the whole PNG, is centred
    LOGO_CENTRE_MOBILE: 0.5,        // on phones (≤ MOBILE px) the whole logo, mark and lettering, is centred instead
    MOBILE: 520,
    canplayTimeout: 8000            // give up and show the end state if the video never becomes playable
  };
  var CUT_GAP = 56;                 // px of white between the hard edge (or the nav pill) and the headline
  var PILL = {
    morphAt: 0.55,                  // handoff progress when the white reaches the nav and the strip starts becoming the pill
    formedAt: 0.85,                 // handoff progress when the pill is fully formed; it then holds until the page scrolls on
    insetRatio: 0.45,               // pill's gap from the screen edge, as a share of the page margin
    minInset: 8,                    // px, never closer to the screen edge than this
    fade: 44,                       // px of soft white gradient right below the pill; text scrolling up fades out here
    parkClear: 24,                  // px of clear white between that fade and the parked headline
    cardsGap: 56                    // px between the parked headline and the cards
  };
  /* ---- Scroll scrubbing feel ---------------------------------------------- */
  var SCRUB = {
    msPerPx: 4.5,        // ms of animation per pixel of wheel scroll (lower = harder to scrub)
    touchFactor: 1.4,    // touch swipes move this much more than the wheel per pixel
    keyStep: 575,        // arrow / page keys move the playhead this many ms
    maxSpeed: 3,         // scroll adds at most 3x real time on top of normal playback; big flicks are queued
    maxQueue: 900,       // ms of scrub that can be queued; the rest of a hard flick is dropped
    reverseSpeed: 6,     // rewinding (scrolling up) is allowed to run faster, so getting back to the start is easy
    reverseQueue: 1600,  // and can queue more
    resumeAfter: 700,    // after scrolling up, wait this long before playing forward again
    smoothing: 0.18      // 0..1, how quickly the drawn frame catches the playhead (lower = softer)
  };

  var CUE_IN = T.handoff + 850;    // the 8-bit scroll arrow fades in as the logo lands in the corner
  var END = CUE_IN + 450;          // ...and the intro ends once it is fully in; the white panel waits for scroll

  var root = document.documentElement;
  var hero = document.querySelector('.hero');
  var track = document.querySelector('.hero-track');
  var video = document.getElementById('hero-video');
  var logo = document.querySelector('.logo img');
  var copy = document.querySelector('.hero-copy');
  var $ = function (s) { return document.querySelector(s); };
  var el = {
    line1: $('.intro-line--1'), line2: $('.intro-line--2'), tagline: $('.intro-tagline'),
    vignette: $('.intro-vignette'), nav: $('.nav'), talk: $('.talk'), cueIn: $('.scroll-cue-in'),
    load: $('.intro-load'), loadArc: $('.intro-load-arc')
  };
  var cue = $('.scroll-cue');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Reduced motion: hold the first frame, no loop, no intro ------------ */
  if (reduced) { video.removeAttribute('autoplay'); video.pause(); }

  /* ---- Phase 2: scroll handoff (runs whenever the intro is not active) ---- */
  var lastP = -1, lastR = -1, ticking = false;
  var media = document.querySelector('.hero-media'), bar = document.querySelector('.bar');
  var G = { W: 0, H: 0, cutY: 0, copyTop: 0, pill: { x: 0, y: 0, b: 0, r: 0 } };
  function measure() {
    // keep the copy on white: the hard edge sits CUT_GAP px above the copy
    var h = hero.offsetHeight;
    var cut = Math.min(62, Math.max(30, ((copy.offsetTop - CUT_GAP) / h) * 100));
    root.style.setProperty('--cut', cut.toFixed(2) + '%');
    // the nav pill: wraps the logo, links and Let’s Talk with an even gap all round
    var bs = getComputedStyle(bar), padX = parseFloat(bs.paddingLeft), padY = parseFloat(bs.paddingTop);
    var inset = Math.max(PILL.minInset, padX * PILL.insetRatio);
    var rowH = bar.offsetHeight - padY;                                   // tallest item in the nav row
    var bottom = padY + rowH + Math.max(6, padY - inset);
    // the parked headline sits clear of the fade under the pill, so nothing fades until you scroll past
    var park = inset + PILL.fade + PILL.parkClear;
    G = { W: media.clientWidth, H: h, VH: media.clientHeight, cutY: cut / 100 * h, copyTop: copy.offsetTop, park: park,
          pill: { x: inset, y: inset, b: bottom, r: (bottom - inset) / 2 } };
    // white band behind the pill: solid down to the same gap below the pill as above it, then a soft fade
    root.style.setProperty('--cap-h', Math.round(bottom + inset + PILL.fade) + 'px');
    root.style.setProperty('--cap-fade', PILL.fade + 'px');
    // cards land just under the parked headline
    root.style.setProperty('--cards-top', Math.round(bottom + park + copy.offsetHeight + PILL.cardsGap) + 'px');
    lastR = lastP = -1;
  }
  function inOut(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function rr(x, y, w, h, r) {   // rounded-rectangle path
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + (r ? 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) : '') +
      'V' + (y + h - r) + (r ? 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) : '') +
      'H' + (x + r) + (r ? 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) : '') +
      'V' + (y + r) + (r ? 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y : '') + 'Z';
  }
  // clip the video to what is not white yet, and move the headline, for the current scroll position
  function drawPanel(r, p) {
    var W = G.W, H = G.H, P = G.pill, edge, s = 0, gap = CUT_GAP;
    if (p <= 0) edge = H + (G.cutY - H) * r;                              // stage 1: bottom → cut
    else if (p < PILL.morphAt) {                                          // stage 2: cut → under the nav
      var k = p / PILL.morphAt;
      edge = G.cutY + (P.b - G.cutY) * k;
      gap = CUT_GAP + (G.park - CUT_GAP) * k;                             // headline eases to its parked gap
    } else {                                                              // strip → pill, then hold
      edge = P.b; gap = G.park;
      s = inOut(Math.min(1, (p - PILL.morphAt) / (PILL.formedAt - PILL.morphAt)));
    }
    var f = function (n) { return n.toFixed(1); };
    if (s <= 0) {
      // video above the white edge only (the page's white shows below it)
      media.style.clipPath = edge >= G.VH ? '' : 'inset(0 0 ' + f(Math.max(0, G.VH - edge)) + 'px 0)';
    } else {
      // the strip above the nav narrows and rounds into the pill, which then stays fixed at the top
      var x = P.x * s, y = P.y * s;
      media.style.clipPath = 'path("' + rr(+f(x), +f(y), +f(W - 2 * x), +f(P.b - y), +f(P.r * s)) + '")';
    }
    copy.style.transform = 'translateY(' + f(edge + gap - G.copyTop) + 'px)';
  }
  // stage 1 (reveal the white panel) takes REVEAL_SCROLL of a screen height; stage 2 (handoff) takes the rest of the track
  var REVEAL_SCROLL = 0.6;
  function update() {
    ticking = false;
    var vh = window.innerHeight, y = window.scrollY;
    var dist = Math.max(1, track.offsetHeight - vh);
    var rd = Math.min(dist - 1, REVEAL_SCROLL * vh);
    var r = Math.round(Math.min(1, Math.max(0, y / rd)) * 1000) / 1000;
    var p = Math.round(Math.min(1, Math.max(0, (y - rd) / (dist - rd))) * 1000) / 1000;
    if (r !== lastR) { lastR = r; root.style.setProperty('--reveal', r); }
    if (p !== lastP) { lastP = p; root.style.setProperty('--handoff', p); }
    drawPanel(r, p);
    cue.classList.toggle('gone', r > 0.08);                               // the arrow leaves once scrolling starts
  }

  /* ---- Scroll cue: click to glide to the cards with the pill fully formed - */
  var autoRaf = 0;
  function stopAuto() { if (autoRaf) { cancelAnimationFrame(autoRaf); autoRaf = 0; } }
  function glideTo(target) {
    stopAuto();
    var y0 = window.scrollY, d = target - y0;
    if (reduced || Math.abs(d) < 2) { window.scrollTo(0, target); return; }
    var dur = Math.max(900, Math.min(2200, Math.abs(d) * 1.2)), t0 = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, y0 + d * inOut(k));
      autoRaf = k < 1 ? requestAnimationFrame(step) : 0;
    })(t0);
  }
  cue.addEventListener('click', function () {
    // the end of the hero track: white fully up, pill fully formed, cards settled
    glideTo(track.offsetHeight - window.innerHeight);
  });
  // any input from the visitor takes control back
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (ev === 'pointerdown' && cue.contains(e.target)) return; stopAuto(); }, { passive: true });
  });
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); measureLogo(); if (active) fitTagline(); });
  measure(); update();

  if (reduced) return;

  /* ---- Easing and helpers ------------------------------------------------- */
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function prog(t, start, dur) { return clamp01((t - start) / dur); }
  function outQuint(x) { return 1 - Math.pow(1 - x, 5); }                       // ≈ cubic-bezier(.22,1,.36,1)
  function inOutCubic(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; } // glide
  function inQuad(x) { return x * x; }
  function easeIn(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; } // word entrances: slow start, soft finish
  // glow flicker envelope over 0..1: a quick flash, a dip, a second flash, then it settles to nothing
  var FLICKER = [[0, 0], [.10, .85], [.18, .25], [.28, 1], [.40, .45], [.52, .7], [1, 0]];
  function flicker(x) {
    if (x <= 0 || x >= 1) return 0;
    for (var i = 1; i < FLICKER.length; i++) if (x <= FLICKER[i][0]) { var a = FLICKER[i - 1], b = FLICKER[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return 0;
  }
  function lerp(a, b, x) { return a + (b - a) * x; }

  /* ---- Logo geometry: it lives in the nav and is transformed to the centre */
  var nav = { x: 0, y: 0, w: 1, h: 1 };
  function measureLogo() {
    var prev = logo.style.transform;
    logo.style.transform = 'none';
    var r = logo.getBoundingClientRect();
    logo.style.transform = prev;
    nav = { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  /* ---- render(t): every intro element as a function of the playhead ------ */
  // words ease in one by one (optionally with a glow flicker); the caller fades the whole line out
  var SHADOW = '0 2px 18px rgba(0,0,0,.34)';
  function words(node, t, start, stagger, fade, rise, glow) {
    var ws = node.__words || (node.__words = node.querySelectorAll('.w'));
    for (var i = 0; i < ws.length; i++) {
      var t0 = start + i * stagger, a = easeIn(prog(t, t0, fade));
      ws[i].style.opacity = a.toFixed(3);
      ws[i].style.transform = 'translateY(' + ((1 - a) * rise).toFixed(2) + 'px)';
      if (glow) {
        var f = flicker(prog(t, t0 + T.GLOW_DELAY, T.GLOW_DUR)) * T.GLOW_PEAK;
        ws[i].style.textShadow = f > 0.005
          ? '0 0 ' + (6 + 10 * f).toFixed(1) + 'px rgba(255,255,255,' + (0.9 * f).toFixed(3) + '),0 0 ' + (18 + 16 * f).toFixed(1) + 'px rgba(255,255,255,' + (0.45 * f).toFixed(3) + '),' + SHADOW
          : '';
      }
    }
  }
  function line(node, spec, t) {
    node.style.opacity = (1 - inQuad(prog(t, spec.out - T.FADE_OUT, T.FADE_OUT))).toFixed(3);
    words(node, t, spec.in, T.WORD_STAGGER, T.WORD_FADE, T.RISE, false);
  }

  // the tagline stays on one line: shrink it to fit narrow screens, wrap only below 13px
  function fitTagline() {
    var n = el.tagline;
    n.classList.remove('wraps'); n.style.fontSize = '';
    if (window.innerWidth > T.MOBILE) fitTaglineSize(n);                // phones: two fixed lines, sized in CSS
    root.style.setProperty('--tag-h', n.offsetHeight + 'px');          // the loading bar sits below whatever height this ends up
  }
  function fitTaglineSize(n) {
    var base = parseFloat(getComputedStyle(n).fontSize);
    var pad = parseFloat(getComputedStyle(document.querySelector('.bar')).paddingLeft) || 20;   // the page's side margin
    var avail = window.innerWidth - 2 * pad;
    var need = n.scrollWidth;
    if (need > avail) {
      var size = base * avail / need;
      if (size >= 13) n.style.fontSize = size.toFixed(2) + 'px';
      else { n.classList.add('wraps'); n.style.fontSize = Math.max(15, base * 0.7).toFixed(2) + 'px'; }
    }
  }
  function fadeIn(node, t, start, dur, rise) {
    var a = outQuint(prog(t, start, dur));
    node.style.opacity = a.toFixed(3);
    if (rise) node.style.transform = 'translateY(' + ((1 - a) * rise).toFixed(2) + 'px)';
  }

  function render(t) {
    var H = T.handoff;
    video.style.opacity = prog(t, 0, T.videoFade).toFixed(3);
    line(el.line1, T.line1, t);
    line(el.line2, T.line2, t);

    // tagline: words ease in one by one with a glow flicker; the line fades out at the handoff
    el.tagline.style.opacity = (1 - prog(t, H, 300)).toFixed(3);
    words(el.tagline, t, T.taglineIn, T.TAG_STAGGER, T.TAG_FADE, 10, true);

    el.vignette.style.opacity = (1 - prog(t, H, 700)).toFixed(3);

    // loading ring: starts with "You", fast at first then slowing (exponential ease-out), full at the handoff
    var lx = prog(t, T.line1.in, H - T.line1.in), K = T.LOAD_CURVE;
    var pct = 100 * (1 - Math.exp(-K * lx)) / (1 - Math.exp(-K));
    // appears in step with "You" (same ease-in as the words)
    el.load.style.opacity = (easeIn(prog(t, T.line1.in, T.WORD_FADE)) * (1 - prog(t, H, T.LOAD_FADE_OUT))).toFixed(3);
    el.loadArc.style.strokeDasharray = pct.toFixed(2) + ' 100';

    // logo: scale-in at centre, then glide to the nav slot (same element throughout)
    var li = outQuint(prog(t, T.logoIn, T.logoInDur));
    var g = inOutCubic(prog(t, H, T.glide));
    var vw = window.innerWidth, vh = window.innerHeight;
    var centreH = Math.min(T.LOGO_CENTER_H, vw * 0.2);
    var k = lerp(centreH / nav.h, 1, g) * lerp(0.9, 1, li);              // total scale vs nav size
    var navY = nav.y - window.scrollY;
    var centreAt = vw <= T.MOBILE ? T.LOGO_CENTRE_MOBILE : T.LOGO_TEXT_CENTRE;
    var shift = (centreAt - 0.5) * nav.w * k;                            // desktop: centre the lettering; phones: the whole logo
    var cx = lerp(vw / 2 - shift, nav.x + nav.w / 2, g), cy = lerp(vh / 2, navY + nav.h / 2, g);
    var tx = cx - nav.x - (nav.w * k) / 2, ty = cy - navY - (nav.h * k) / 2;
    logo.style.opacity = li.toFixed(3);
    logo.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';

    // handoff: nav arrives while the logo lands. The video stays full frame;
    // the white panel and headline only come in once the visitor scrolls.
    fadeIn(el.nav, t, H + 450, 600);
    fadeIn(el.talk, t, H + 520, 600);
    fadeIn(el.cueIn, t, CUE_IN, 450);
  }

  var drawn = [video, logo, el.line1, el.line2, el.tagline, el.vignette, el.nav, el.talk, el.cueIn, el.load];
  function clearInline() { drawn.forEach(function (n) { n.style.opacity = ''; n.style.transform = ''; }); }

  /* ---- Playhead ----------------------------------------------------------- */
  var active = false, ready = false, raf = 0, last = 0;
  var target = 0, shown = 0, pending = 0, lastBack = -1e9, giveUpTimer = 0;

  function enter(atT) {
    active = true;
    root.classList.add('intro');
    window.scrollTo(0, 0);
    measureLogo(); fitTagline();
    target = shown = atT; pending = 0;
    render(shown);
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function exit() {
    active = false;
    cancelAnimationFrame(raf); raf = 0;
    clearInline();
    root.classList.remove('intro');
    measure(); update();
  }
  function tick(now) {
    raf = 0;
    if (!active) return;
    // rAF's timestamp can be a few ms earlier than performance.now() taken in enter(); never let dt go negative
    var dt = Math.max(0, Math.min(64, now - last)); last = now;
    // scroll input is released at no more than maxSpeed x real time
    var step = pending < 0 ? Math.max(-SCRUB.reverseSpeed * dt, pending) : Math.min(SCRUB.maxSpeed * dt, pending);
    pending -= step; target += step;
    // plays forward on its own, except just after the user scrolled backwards
    if (ready && now - lastBack > SCRUB.resumeAfter) target += dt;
    // drop queued scroll only when it pushes past the end it is already at
    if ((target <= 0 && pending < 0) || (target >= END && pending > 0)) pending = 0;
    target = Math.max(0, Math.min(END, target));
    var f = 1 - Math.pow(1 - SCRUB.smoothing, dt / 16.7);          // frame-rate independent
    shown += (target - shown) * f;
    if (Math.abs(target - shown) < 1) shown = target;
    render(shown);
    // finished only when at the end with no scroll-back still queued (re-entry starts at END with pending < 0)
    if (shown >= END && target >= END && pending >= 0) { exit(); return; }
    raf = requestAnimationFrame(tick);
  }
  function nudge(ms) {
    if (!ready) return;
    // reversing direction drops whatever was queued the other way
    if ((ms < 0 && pending > 0) || (ms > 0 && pending < 0)) pending = 0;
    pending = Math.max(-SCRUB.reverseQueue, Math.min(SCRUB.maxQueue, pending + ms));
    if (ms < 0) lastBack = performance.now();
  }
  function skipToEnd() { target = shown = END; pending = 0; }

  /* ---- Input: wheel, touch and keys scrub; click skips -------------------- */
  function atTop() { return window.scrollY <= 0; }

  window.addEventListener('wheel', function (e) {
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    if (active) { e.preventDefault(); nudge(dy * SCRUB.msPerPx); return; }
    if (dy < 0 && atTop() && ready) { e.preventDefault(); enter(END); nudge(dy * SCRUB.msPerPx); }
  }, { passive: false });

  var touchY = null;
  window.addEventListener('touchstart', function (e) { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (touchY == null) return;
    var y = e.touches[0].clientY, dy = touchY - y; touchY = y;          // finger up = forward
    if (active) { e.preventDefault(); nudge(dy * SCRUB.msPerPx * SCRUB.touchFactor); return; }
    if (dy < 0 && atTop() && ready) { e.preventDefault(); enter(END); nudge(dy * SCRUB.msPerPx * SCRUB.touchFactor); }
  }, { passive: false });
  window.addEventListener('touchend', function () { touchY = null; }, { passive: true });

  window.addEventListener('keydown', function (e) {
    var fwd = { ArrowDown: 1, PageDown: 1, ' ': 1, Spacebar: 1 }[e.key];
    var back = { ArrowUp: 1, PageUp: 1 }[e.key];
    if (active) {
      if (e.key === 'Escape' || e.key === 'Enter') { skipToEnd(); return; }
      if (fwd) { e.preventDefault(); nudge(SCRUB.keyStep); }
      else if (back) { e.preventDefault(); nudge(-SCRUB.keyStep); }
      return;
    }
    if ((back || e.key === 'Home') && atTop() && ready) { e.preventDefault(); enter(END); nudge(-SCRUB.keyStep); }
  });

  // a click (not a swipe) during the intro skips to the end state; it never follows a link
  // (the centred logo is the nav's home link)
  window.addEventListener('click', function (e) { if (active) { e.preventDefault(); skipToEnd(); } }, true);

  // scroll lock during the intro: wheel, touch and keys are intercepted above; this catches the rest
  // (dragging the scrollbar, End key, middle-click autoscroll). The scrollbar stays visible, so the
  // page width never changes when the intro ends.
  window.addEventListener('scroll', function () { if (active && window.scrollY !== 0) window.scrollTo(0, 0); }, { passive: true });

  window.addEventListener('resize', function () {
    measure();
    if (active) { measureLogo(); fitTagline(); render(shown); } else onScroll();
  }, { passive: true });

  /* ---- Start: draw frame 0 now, start the playhead once the video can play */
  if (!root.classList.contains('intro')) return;
  enter(0);
  function start() { if (ready) return; ready = true; clearTimeout(giveUpTimer); last = performance.now(); }
  if (video.readyState >= 3) start();
  else {
    video.addEventListener('canplay', start, { once: true });
    video.addEventListener('error', function () { ready = true; target = shown = END; }, { once: true });
    giveUpTimer = setTimeout(function () { ready = true; target = shown = END; }, T.canplayTimeout);
  }
})();
