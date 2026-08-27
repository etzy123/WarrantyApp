(function () {
  var selection = null; // { title, vendor, sku, routingType, customer, customerEmail, source }
  var currentOrder = null;
  var selectedPhotos = []; // File objects, max 4
  var MAX_PHOTOS = 4;
  var MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  function iconCheck(){ return '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function iconFlag(){ return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2v20M12 4h7l-1.5 3L19 10h-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function iconMail(){ return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6l8 6 8-6M4 6h16v12H4V6z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }

  function toast(title, body) {
    var stack = document.getElementById("toastStack");
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = iconMail() + "<div><b>" + title + "</b><span>" + (body || "") + "</span></div>";
    stack.appendChild(el);
    setTimeout(function () {
      el.classList.add("leaving");
      setTimeout(function () { el.remove(); }, 200);
    }, 4200);
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- load brand list for the manual fallback dropdown ----------
  var brandSelect = document.getElementById("f-brand");
  var brandsByName = {};
  fetch("/api/brands")
    .then(function (r) { return r.json(); })
    .then(function (brands) {
      brandSelect.innerHTML = "";
      var placeholder = document.createElement("option");
      placeholder.value = ""; placeholder.textContent = "Select a brand"; placeholder.disabled = true; placeholder.selected = true;
      brandSelect.appendChild(placeholder);
      brands.forEach(function (b) {
        brandsByName[b.name] = b;
        var opt = document.createElement("option");
        opt.value = b.name;
        opt.textContent = b.name + (b.house ? " (in-house)" : "");
        brandSelect.appendChild(opt);
      });
    })
    .catch(function () {
      brandSelect.innerHTML = '<option value="">Couldn\'t load brands — refresh to retry</option>';
    });

  function resolveSelection(sel) {
    selection = sel;
    document.getElementById("restOfForm").style.display = "block";
    var name = document.getElementById("f-name");
    var email = document.getElementById("f-email");
    if (sel.customer && !name.value) name.value = sel.customer;
    if (sel.customerEmail && !email.value) email.value = sel.customerEmail;
    document.getElementById("restOfForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- photo upload (drag-and-drop + click-to-browse) ----------
  var uploadZone = document.getElementById("uploadZone");
  var photoInput = document.getElementById("f-photos");
  var photoPreview = document.getElementById("photoPreview");

  function renderPhotoPreview() {
    photoPreview.innerHTML = selectedPhotos.map(function (file, i) {
      return '<div class="photo-thumb"><img src="' + URL.createObjectURL(file) + '" alt=""><button type="button" onclick="window.__removePhoto(' + i + ')" aria-label="Remove photo">&times;</button></div>';
    }).join("");
  }

  window.__removePhoto = function (i) {
    selectedPhotos.splice(i, 1);
    renderPhotoPreview();
  };

  function addPhotos(fileList) {
    var rejected = [];
    Array.prototype.forEach.call(fileList, function (file) {
      if (selectedPhotos.length >= MAX_PHOTOS) return;
      if (!/^image\//.test(file.type)) { rejected.push(file.name + " isn't an image"); return; }
      if (file.size > MAX_PHOTO_BYTES) { rejected.push(file.name + " is over 5MB"); return; }
      selectedPhotos.push(file);
    });
    renderPhotoPreview();
    if (rejected.length) toast("Some photos were skipped", rejected.join(", "));
  }

  uploadZone.addEventListener("click", function () { photoInput.click(); });
  uploadZone.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); photoInput.click(); } });
  photoInput.addEventListener("change", function () { addPhotos(photoInput.files); photoInput.value = ""; });

  ["dragenter", "dragover"].forEach(function (evt) {
    uploadZone.addEventListener(evt, function (e) { e.preventDefault(); uploadZone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    uploadZone.addEventListener(evt, function (e) { e.preventDefault(); uploadZone.classList.remove("dragover"); });
  });
  uploadZone.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addPhotos(e.dataTransfer.files);
  });

  // ---------- order lookup ----------
  document.getElementById("lookupBtn").addEventListener("click", function () {
    var raw = document.getElementById("f-order").value.trim().replace(/^#/, "");
    var lookupEmail = document.getElementById("f-lookup-email").value.trim();
    var resultHost = document.getElementById("orderResult");
    var errorHost = document.getElementById("lookupError");
    var manualBlock = document.getElementById("manualBlock");
    document.getElementById("restOfForm").style.display = "none";
    errorHost.innerHTML = "";
    resultHost.innerHTML = "";
    selection = null;
    if (!raw && !lookupEmail) return;
    if (!raw || !lookupEmail) {
      errorHost.innerHTML = '<div class="lookup-fail"><b>Both fields are needed</b>Enter the order number and the email it was placed with.</div>';
      return;
    }

    var btn = document.getElementById("lookupBtn");
    btn.disabled = true;
    btn.textContent = "Looking up…";

    fetch("/api/order-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber: raw, email: lookupEmail }),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = "Find order";

        if (!res.ok) {
          if (res.body && /not configured/i.test(res.body.error || "")) {
            errorHost.innerHTML = '<div class="lookup-fail"><b>Shopify isn\'t connected yet</b>' + esc(res.body.error) + "</div>";
          } else if (res.status === 429) {
            errorHost.innerHTML = '<div class="lookup-fail"><b>Too many attempts</b>' + esc(res.body.error) + "</div>";
          } else {
            resultHost.innerHTML = '<div class="lookup-fail"><b>We couldn\'t find that order</b>No order matches that number and email together. Enter the product below and we\'ll route it manually.</div>';
            manualBlock.style.display = "block";
          }
          return;
        }

        currentOrder = res.body;
        manualBlock.style.display = "none";

        var itemsHtml = res.body.items.map(function (item, i) {
          return '<div class="item-option" data-idx="' + i + '" onclick="window.__pickItem(' + i + ')">' +
            (item.image ? '<img src="' + esc(item.image) + '" alt="">' : '<div style="width:38px;height:38px;border-radius:6px;background:var(--surface-sunk);flex-shrink:0;"></div>') +
            '<div style="flex:1;"><div class="it-title">' + esc(item.title) + "</div>" +
            '<div class="it-meta">' + (item.sku ? "SKU " + esc(item.sku) + " · " : "") + "Qty " + item.quantity + "</div></div>" +
            '<div class="it-radio"></div></div>';
        }).join("");

        resultHost.innerHTML =
          '<div class="order-found"><div class="order-found-head"><span class="oid">Order <b>#' + esc(raw) + "</b>" + (res.body.customerName ? " · " + esc(res.body.customerName) : "") + "</span></div>" +
          (res.body.items.length > 1 ? '<div class="card-hint" style="margin-bottom:8px;">Which item is this claim about?</div>' : "") +
          itemsHtml +
          '<div id="selectionNoteHost"></div></div>';

        if (res.body.items.length === 1) window.__pickItem(0);
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Find order";
        errorHost.innerHTML = '<div class="lookup-fail"><b>Something went wrong</b>Could not reach the server. Try again in a moment.</div>';
      });
  });

  window.__pickItem = function (idx) {
    var item = currentOrder.items[idx];
    document.querySelectorAll("#orderResult .item-option").forEach(function (el, i) {
      el.classList.toggle("selected", i === idx);
    });

    var noteHost = document.getElementById("selectionNoteHost");
    var note = "";
    if (item.routingType === "house") {
      note = '<div class="selection-note">' + iconCheck() + "<div>This is one of our own Bisque Golf products — it routes straight to our internal QC team, no brand email needed.</div></div>";
    } else if (item.routingType === "ambiguous") {
      note = '<div class="selection-note flag">' + iconFlag() + "<div>We couldn't confidently match this item to one brand contact — it'll be flagged for a teammate to route by hand.</div></div>";
    } else {
      note = '<div class="selection-note">' + iconCheck() + "<div>Matched to <b>" + esc(item.vendor) + "</b> — we'll email their warranty contact automatically.</div></div>";
    }
    if (noteHost) noteHost.innerHTML = note;

    resolveSelection({
      title: item.title, vendor: item.vendor, sku: item.sku, routingType: item.routingType,
      customer: currentOrder.customerName, customerEmail: currentOrder.customerEmail, source: "order",
    });
  };

  // ---------- manual fallback ----------
  function checkManual() {
    var brand = document.getElementById("f-brand").value;
    var model = document.getElementById("f-model").value.trim();
    if (!brand) return;
    var b = brandsByName[brand];
    var routingType = b ? (b.house ? "house" : "external") : "ambiguous";
    resolveSelection({ title: model || "(model not specified)", vendor: brand, sku: null, routingType: routingType, customer: null, customerEmail: null, source: "manual" });
  }
  document.getElementById("f-brand").addEventListener("change", checkManual);
  document.getElementById("f-model").addEventListener("blur", checkManual);

  // ---------- submit ----------
  document.getElementById("claimForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selection) return;

    var submitBtn = document.getElementById("submitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    var formData = new FormData();
    formData.append("orderNumber", document.getElementById("f-order").value.trim().replace(/^#/, ""));
    formData.append("customerName", document.getElementById("f-name").value.trim());
    formData.append("customerEmail", document.getElementById("f-email").value.trim());
    formData.append("brandName", selection.vendor || "");
    formData.append("productTitle", selection.title);
    formData.append("sku", selection.sku || "");
    formData.append("issue", document.getElementById("f-issue").value.trim() || "No description provided.");
    selectedPhotos.forEach(function (file) { formData.append("photos", file); });

    fetch("/api/claims", {
      method: "POST",
      body: formData,
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit claim";
        if (!res.ok) {
          toast("Couldn't submit claim", res.body.error || "Please try again.");
          return;
        }
        renderTracker(res.body);
        selectedPhotos = [];
        renderPhotoPreview();
        if (res.body.routing_type === "ambiguous") {
          toast("Flagged for manual routing", res.body.id + " needs a teammate to confirm the brand");
        } else if (res.body.routing_type === "house") {
          toast("Sent to internal QC", "Bisque Golf QC team notified");
        } else {
          toast("Email sent to brand", res.body.brand_name + "'s warranty contact notified");
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit claim";
        toast("Couldn't submit claim", "Could not reach the server. Try again in a moment.");
      });
  });

  function stageTitleFor(stage, routingType) {
    if (stage === "submitted") return "Claim submitted";
    if (stage === "routed") return routingType === "house" ? "Routed internally" : "Sent to brand";
    if (stage === "processing") return routingType === "house" ? "QC reviewing" : "Brand reviewing";
    if (stage === "resolved") return "Resolved";
    if (stage === "attention") return "Needs manual routing";
    return stage;
  }

  var STAGES = ["submitted", "routed", "processing", "resolved"];

  function renderTracker(claim) {
    var slot = document.getElementById("trackerSlot");
    var isAttention = claim.stage === "attention";
    var idx = isAttention ? 1 : STAGES.indexOf(claim.stage);

    var stepsHtml;
    if (isAttention) {
      stepsHtml =
        '<div class="step done"><div class="step-rail"><div class="step-dot">' + iconCheck() + '</div><div class="step-line"></div></div>' +
        '<div class="step-body"><div class="step-title">Claim submitted</div><div class="step-meta">' + fmtTime(claim.created_at) + '</div></div></div>' +
        '<div class="step flagged"><div class="step-rail"><div class="step-dot" style="color:var(--status-attention);">' + iconFlag() + '</div></div>' +
        '<div class="step-body"><div class="step-title" style="color:var(--status-attention);">Needs manual routing</div><div class="step-meta">A teammate will confirm the brand contact</div></div></div>';
    } else {
      stepsHtml = STAGES.map(function (stage, i) {
        var state = i < idx ? "done" : (i === idx ? "current" : "pending");
        var title = stageTitleFor(stage, claim.routing_type);
        var check = state === "done" ? iconCheck() : "";
        return '<div class="step ' + state + '"><div class="step-rail"><div class="step-dot">' + check + "</div>" + (i < STAGES.length - 1 ? '<div class="step-line"></div>' : "") + "</div>" +
          '<div class="step-body"><div class="step-title">' + title + "</div>" +
          (state !== "pending" ? '<div class="step-meta">' + fmtTime(claim.updated_at) + "</div>" : "") + "</div></div>";
      }).join("");
    }

    var bodyHtml;
    if (isAttention) {
      bodyHtml = '<div class="card-hint">This item didn\'t map cleanly to one brand. Rather than guess and send it to the wrong contact, it waits here for a teammate.</div>';
    } else if (claim.routing_type === "house") {
      bodyHtml = idx >= 1
        ? '<div class="card-hint">Routed internally — Bisque Golf\'s own QC team was notified, no brand email needed.</div>'
        : '<div class="card-hint">In-house product — this will route to our own QC team instead of an external brand.</div>';
    } else {
      bodyHtml = idx >= 1
        ? '<div class="card-hint">We emailed ' + esc(claim.brand_name) + '\'s warranty contact with your claim details.</div>'
        : '<div class="card-hint">We\'ll notify ' + esc(claim.brand_name) + '\'s warranty contact automatically once this is routed.</div>';
    }

    slot.innerHTML =
      '<div class="card"><div class="tracker-head"><h2>Your claim tracker</h2><span class="claim-id">Ref <b>' + esc(claim.id) + '</b></span></div>' +
      '<div class="steps">' + stepsHtml + "</div>" + bodyHtml + "</div>";
  }
})();
