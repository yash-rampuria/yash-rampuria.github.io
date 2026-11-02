/* ==========================================================
   Yash Rampuria · portfolio interactions
   ========================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Navbar shadow on scroll ---------- */
  var navbar = document.getElementById('navbar');
  function onScroll() {
    navbar.classList.toggle('scrolled', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('nav-links');
  function setMenu(open) {
    links.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  toggle.addEventListener('click', function () {
    setMenu(!links.classList.contains('open'));
  });
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
  });

  /* ---------- Active section in nav ---------- */
  var navAnchors = Array.prototype.slice.call(links.querySelectorAll('a'));
  var sections = navAnchors
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);
  if ('IntersectionObserver' in window) {
    var activeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navAnchors.forEach(function (a) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { activeObserver.observe(s); });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- Hide resume links until the PDF is uploaded ---------- */
  var resumeEls = document.querySelectorAll('[data-resume]');
  if (resumeEls.length && location.protocol.indexOf('http') === 0) {
    fetch('Yash_Rampuria_Resume.pdf', { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('missing'); })
      .catch(function () {
        resumeEls.forEach(function (el) { el.hidden = true; });
      });
  }

  /* ======================================================
     Hero: a robot builds a navigation graph while exploring.
     Nodes are sampled in free space, revealed by a range
     sensor with line of sight, and the robot repeatedly
     plans (Dijkstra) to the nearest frontier node.
     ====================================================== */
  var canvas = document.getElementById('graph-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var statNodes = document.getElementById('stat-nodes');
  var statFrontier = document.getElementById('stat-frontier');
  var statExplored = document.getElementById('stat-explored');

  var W = 0, H = 0, dpr = 1;
  var colors = {};
  var world = null;
  var running = false;
  var visible = true;
  var lastT = 0;

  function readColors() {
    var cs = getComputedStyle(root);
    var v = function (name) { return cs.getPropertyValue(name).trim(); };
    colors = {
      bg: v('--surface'),
      ink: v('--ink'),
      ink2: v('--ink-2'),
      muted: v('--muted'),
      line: v('--line'),
      lineStrong: v('--line-strong'),
      accent: v('--accent'),
      gold: v('--gold')
    };
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Liang–Barsky segment vs. axis-aligned rectangle test.
  function segHitsRect(x0, y0, x1, y1, r) {
    var dx = x1 - x0, dy = y1 - y0;
    var p = [-dx, dx, -dy, dy];
    var q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
    var u0 = 0, u1 = 1;
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return false;
      } else {
        var t = q[i] / p[i];
        if (p[i] < 0) { if (t > u1) return false; if (t > u0) u0 = t; }
        else { if (t < u0) return false; if (t < u1) u1 = t; }
      }
    }
    return true;
  }

  function blocked(x0, y0, x1, y1, obstacles, pad) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      var r = { x: o.x - pad, y: o.y - pad, w: o.w + 2 * pad, h: o.h + 2 * pad };
      if (segHitsRect(x0, y0, x1, y1, r)) return true;
    }
    return false;
  }

  function insideAny(x, y, obstacles, pad) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true;
    }
    return false;
  }

  function buildWorld() {
    var s = Math.max(24, Math.min(W, H) / 11);
    var margin = s * 0.6;
    var start = { x: W * rand(0.12, 0.22), y: H * rand(0.72, 0.85) };

    // Obstacles: a mix of blocks and thin walls, kept clear of the start.
    var obstacles = [];
    var tries = 0;
    while (obstacles.length < 7 && tries++ < 200) {
      var wall = Math.random() < 0.5;
      var w, h;
      if (wall) {
        if (Math.random() < 0.5) { w = rand(0.22, 0.4) * W; h = s * 0.32; }
        else { w = s * 0.32; h = rand(0.22, 0.4) * H; }
      } else {
        w = rand(0.08, 0.17) * W; h = rand(0.08, 0.2) * H;
      }
      var o = { x: rand(margin, W - margin - w), y: rand(margin, H - margin - h), w: w, h: h };
      var cx = Math.max(o.x, Math.min(start.x, o.x + o.w));
      var cy = Math.max(o.y, Math.min(start.y, o.y + o.h));
      if (Math.hypot(cx - start.x, cy - start.y) < s * 2.2) continue;
      obstacles.push(o);
    }

    // Jittered-grid node samples in free space.
    var nodes = [];
    for (var y = margin; y <= H - margin + 1; y += s) {
      for (var x = margin; x <= W - margin + 1; x += s) {
        var nx = x + rand(-0.28, 0.28) * s;
        var ny = y + rand(-0.28, 0.28) * s;
        if (nx < 6 || ny < 6 || nx > W - 6 || ny > H - 6) continue;
        if (insideAny(nx, ny, obstacles, 7)) continue;
        nodes.push({ x: nx, y: ny, adj: [], seen: false });
      }
    }

    // Collision-free edges between nearby samples.
    var maxD = s * 1.55;
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var a = nodes[i], b = nodes[j];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > maxD || blocked(a.x, a.y, b.x, b.y, obstacles, 4)) continue;
        a.adj.push({ to: j, d: d });
        b.adj.push({ to: i, d: d });
      }
    }

    // Keep only the component reachable from the start node.
    var startIdx = 0, best = Infinity;
    nodes.forEach(function (n, k) {
      var d = Math.hypot(n.x - start.x, n.y - start.y);
      if (d < best) { best = d; startIdx = k; }
    });
    var keep = new Array(nodes.length).fill(false);
    var stack = [startIdx];
    keep[startIdx] = true;
    while (stack.length) {
      var u = stack.pop();
      nodes[u].adj.forEach(function (e) {
        if (!keep[e.to]) { keep[e.to] = true; stack.push(e.to); }
      });
    }
    var remap = {}, kept = [];
    nodes.forEach(function (n, k) { if (keep[k]) { remap[k] = kept.length; kept.push(n); } });
    kept.forEach(function (n) {
      n.adj = n.adj.filter(function (e) { return keep[e.to]; })
        .map(function (e) { return { to: remap[e.to], d: e.d }; });
    });

    var startNode = kept[remap[startIdx]];
    return {
      s: s,
      obstacles: obstacles,
      nodes: kept,
      robot: { x: startNode.x, y: startNode.y, node: remap[startIdx] },
      path: [],
      trail: [{ x: startNode.x, y: startNode.y }],
      sensor: s * 2.5,
      speed: s * 2.3,
      seenCount: 0,
      frontier: [],
      done: false,
      doneAt: 0
    };
  }

  function observe(w) {
    var r = w.robot, R2 = w.sensor * w.sensor;
    for (var i = 0; i < w.nodes.length; i++) {
      var n = w.nodes[i];
      if (n.seen) continue;
      var dx = n.x - r.x, dy = n.y - r.y;
      if (dx * dx + dy * dy > R2) continue;
      if (blocked(r.x, r.y, n.x, n.y, w.obstacles, 1)) continue;
      n.seen = true;
      w.seenCount++;
    }
    w.frontier = [];
    for (var k = 0; k < w.nodes.length; k++) {
      var m = w.nodes[k];
      if (!m.seen) continue;
      for (var e = 0; e < m.adj.length; e++) {
        if (!w.nodes[m.adj[e].to].seen) { w.frontier.push(k); break; }
      }
    }
  }

  // Dijkstra over the observed subgraph to the nearest frontier node.
  function planToFrontier(w) {
    var N = w.nodes.length;
    var dist = new Array(N).fill(Infinity);
    var prev = new Array(N).fill(-1);
    var done = new Array(N).fill(false);
    var isFrontier = {};
    w.frontier.forEach(function (k) { isFrontier[k] = true; });
    dist[w.robot.node] = 0;
    for (;;) {
      var u = -1, bd = Infinity;
      for (var i = 0; i < N; i++) {
        if (!done[i] && dist[i] < bd && w.nodes[i].seen) { bd = dist[i]; u = i; }
      }
      if (u === -1) return [];
      if (isFrontier[u] && u !== w.robot.node) {
        var path = [];
        for (var v = u; v !== w.robot.node; v = prev[v]) path.unshift(v);
        return path;
      }
      done[u] = true;
      w.nodes[u].adj.forEach(function (e) {
        if (!w.nodes[e.to].seen) return;
        var nd = dist[u] + e.d;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
      });
    }
  }

  function step(w, dt, now) {
    if (w.done) {
      if (now - w.doneAt > 2600) { world = buildWorld(); observe(world); }
      return;
    }
    if (!w.path.length) {
      w.path = planToFrontier(w);
      if (!w.path.length) { w.done = true; w.doneAt = now; return; }
    }
    var move = w.speed * dt;
    while (move > 0 && w.path.length) {
      var target = w.nodes[w.path[0]];
      var dx = target.x - w.robot.x, dy = target.y - w.robot.y;
      var d = Math.hypot(dx, dy);
      if (d <= move) {
        w.robot.x = target.x; w.robot.y = target.y;
        w.robot.node = w.path.shift();
        move -= d;
        observe(w);
        // Replan at every node so newly revealed frontiers are used.
        w.path = planToFrontier(w);
        if (!w.path.length) { w.done = true; w.doneAt = now; break; }
      } else {
        w.robot.x += (dx / d) * move;
        w.robot.y += (dy / d) * move;
        move = 0;
      }
    }
    var last = w.trail[w.trail.length - 1];
    if (Math.hypot(last.x - w.robot.x, last.y - w.robot.y) > 3) {
      w.trail.push({ x: w.robot.x, y: w.robot.y });
      if (w.trail.length > 900) w.trail.shift();
    }
  }

  function withAlpha(color, a) {
    ctx.globalAlpha = a;
    return color;
  }

  function draw(w, now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);

    // Faint background grid.
    ctx.strokeStyle = withAlpha(colors.line, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx < W; gx += w.s) { ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); }
    for (var gy = 0; gy < H; gy += w.s) { ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); }
    ctx.stroke();

    // Obstacles.
    ctx.fillStyle = withAlpha(colors.lineStrong, 0.9);
    w.obstacles.forEach(function (o) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(o.x, o.y, o.w, o.h, 4); else ctx.rect(o.x, o.y, o.w, o.h);
      ctx.fill();
    });

    // Sensor footprint.
    ctx.fillStyle = withAlpha(colors.accent, 0.06);
    ctx.beginPath();
    ctx.arc(w.robot.x, w.robot.y, w.sensor, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(colors.accent, 0.22);
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Observed edges.
    ctx.strokeStyle = withAlpha(colors.ink2, 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < w.nodes.length; i++) {
      var n = w.nodes[i];
      if (!n.seen) continue;
      for (var e = 0; e < n.adj.length; e++) {
        var j = n.adj[e].to;
        if (j < i || !w.nodes[j].seen) continue;
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(w.nodes[j].x, w.nodes[j].y);
      }
    }
    ctx.stroke();

    // Trail.
    if (w.trail.length > 1) {
      ctx.strokeStyle = withAlpha(colors.accent, 0.55);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(w.trail[0].x, w.trail[0].y);
      for (var t = 1; t < w.trail.length; t++) ctx.lineTo(w.trail[t].x, w.trail[t].y);
      ctx.lineTo(w.robot.x, w.robot.y);
      ctx.stroke();
    }

    // Planned path.
    if (w.path.length) {
      ctx.strokeStyle = withAlpha(colors.gold, 0.9);
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(w.robot.x, w.robot.y);
      w.path.forEach(function (k) { ctx.lineTo(w.nodes[k].x, w.nodes[k].y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Observed nodes.
    ctx.fillStyle = withAlpha(colors.ink, 0.75);
    for (var m = 0; m < w.nodes.length; m++) {
      var nd = w.nodes[m];
      if (!nd.seen) continue;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Frontier nodes with a soft pulse.
    var pulse = 0.5 + 0.5 * Math.sin(now / 320);
    w.frontier.forEach(function (k) {
      var f = w.nodes[k];
      ctx.fillStyle = withAlpha(colors.gold, 0.18 + 0.12 * pulse);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 6 + 2 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha(colors.gold, 1);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Robot.
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(w.robot.x, w.robot.y, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(w.robot.x, w.robot.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Stats.
    statNodes.textContent = w.seenCount;
    statFrontier.textContent = w.frontier.length;
    statExplored.textContent = Math.round((100 * w.seenCount) / w.nodes.length) + '%';
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    world = buildWorld();
    observe(world);
    if (reduceMotion) {
      // Show a representative mid-exploration snapshot instead of animating.
      for (var i = 0; i < 4000 && !world.done && world.seenCount < world.nodes.length * 0.6; i++) {
        step(world, 1 / 30, 0);
      }
      draw(world, 0);
    }
  }

  function frame(now) {
    if (!running) return;
    var dt = Math.min((now - lastT) / 1000, 1 / 20);
    lastT = now;
    step(world, dt, now);
    draw(world, now);
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduceMotion || !visible || document.hidden || !world) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }
  function stop() { running = false; }

  readColors();
  resize();
  start();

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var rect = canvas.getBoundingClientRect();
      if (Math.abs(rect.width - W) > 2 || Math.abs(rect.height - H) > 2) {
        stop(); resize(); start();
      }
    }, 150);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }).observe(canvas);
  }
})();
