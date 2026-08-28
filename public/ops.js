(function () {
  var STAGE_CHIP = { submitted: "chip-submitted", routed: "chip-routed", processing: "chip-processing", resolved: "chip-resolved", attention: "chip-attention" };
  var STAGE_LABEL = { submitted: "Submitted", routed: "Routed", processing: "Processing", resolved: "Resolved", attention: "Needs routing" };
  var ALL_STAGES = ["submitted", "routed", "processing", "resolved", "attention"];
  var brandsCache = [];
  var claimsCache = [];

  // Builds a single-quoted JS string literal safe to embed inside a
  // double-quoted HTML onclick="..." attribute (JSON.stringify() produces a
  // double-quoted literal, which breaks that attribute the moment the value
  // contains a space or anything else — that was the bug).
  function jsAttr(s) {
    return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function toast(title, body) {
    var stack = document.getElementById("toastStack");
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = "<div><b>" + esc(title) + "</b><span>" + esc(body || "") + "</span></div>";
    stack.appendChild(el);
    setTimeout(function () { el.classList.add("leaving"); setTimeout(function () { el.remove(); }, 200); }, 4200);
  }
  function stageTitleFor(stage, routingType) {
    if (stage === "submitted") return "Claim submitted";
    if (stage === "routed") return routingType === "house" ? "Routed internally" : "Sent to brand";
    if (stage === "processing") return routingType === "house" ? "QC reviewing" : "Brand reviewing";
    if (stage === "resolved") return "Resolved";
    if (stage === "attention") return "Needs manual routing";
    return stage;
  }

  // ---------- modal helpers ----------
  var backdrop = document.getElementById("editModalBackdrop");
  var modalCard = document.getElementById("editModalCard");
  function openModal(html) {
    modalCard.innerHTML = html;
    backdrop.classList.add("open");
  }
  function closeModal() {
    backdrop.classList.remove("open");
    modalCard.innerHTML = "";
  }
  backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeModal(); });
  window.__closeModal = closeModal;

  // ---------- brands (read-only here — just to populate dropdowns; the
  // brand directory itself lives on its own page now, ops-brands.html) ----------
  function loadBrandsForDropdowns() {
    return fetch("/api/ops/brands").then(function (r) { return r.json(); }).then(function (brands) {
      brandsCache = brands;
    });
  }

  // ---------- claims queue ----------
  var statusFilter = document.getElementById("statusFilter");
  var claimSearch = document.getElementById("claimSearch");

  function matchesFilters(c) {
    if (statusFilter.value && c.stage !== statusFilter.value) return false;
    var q = claimSearch.value.trim().toLowerCase();
    if (!q) return true;
    var haystack = [c.id, c.customer_name, c.order_number, c.brand_name, c.product_title].map(function (v) { return (v || "").toLowerCase(); }).join(" ");
    return haystack.indexOf(q) !== -1;
  }

  function renderClaims() {
    var claims = claimsCache.filter(matchesFilters);
    var suffix = claims.length === claimsCache.length ? "" : " of " + claimsCache.length;
    document.getElementById("queueCount").textContent = claims.length + suffix + " claim" + (claims.length === 1 ? "" : "s") + " shown";
    document.getElementById("queueTableBody").innerHTML = claims.map(function (c) {
      var chipClass = STAGE_CHIP[c.stage];
      var label = stageTitleFor(c.stage, c.routing_type);
      // An external claim sits at "submitted" until you deliberately send
      // it — nothing brand-facing (advancing the stage, an invoice) makes
      // sense before that, so those actions stay hidden until it's sent.
      var pendingSend = c.routing_type === "external" && c.stage === "submitted";
      var canAdvance = c.stage !== "resolved" && c.stage !== "attention" && !pendingSend;
      var brandCell = c.routing_type === "ambiguous"
        ? '<span class="cell-faint">Unmatched</span><span class="tag tag-flag">Flagged</span>'
        : esc(c.brand_name) + (c.routing_type === "house" ? '<span class="tag tag-house">In-house</span>' : "");
      var photosCell = c.photo_count > 0
        ? '<button class="photo-badge" onclick="window.__viewPhotos(' + jsAttr(c.id) + ')">' + c.photo_count + ' photo' + (c.photo_count === 1 ? "" : "s") + '</button>'
        : '<span class="cell-faint">—</span>';
      var actions = '<button class="btn btn-ghost btn-small" onclick="window.__editClaim(' + jsAttr(c.id) + ')">Edit</button> ';
      if (pendingSend) {
        actions += '<button class="btn btn-primary btn-small" style="width:auto;" onclick="window.__sendToBrand(' + jsAttr(c.id) + ')">Send to brand</button> ';
      }
      if (canAdvance) actions += '<button class="btn btn-ghost btn-small" onclick="window.__advance(\'' + c.id + '\')">Simulate response</button> ';
      if (c.stage === "attention") {
        actions += '<select onchange="window.__route(\'' + c.id + '\', this.value)" style="width:auto;display:inline-block;">' +
          '<option value="">Route to…</option>' +
          brandsCache.filter(function (b) { return !b.house; }).map(function (b) { return '<option value="' + esc(b.name) + '">' + esc(b.name) + "</option>"; }).join("") +
          "</select>";
      }
      if (c.routing_type === "external" && c.unit_price != null && !pendingSend) {
        actions += '<button class="btn btn-ghost btn-small" onclick="window.__sendInvoice(' + jsAttr(c.id) + ')">' + (c.invoice_sent_at ? "Resend invoice" : "Send invoice") + '</button> ';
      }
      var invoiceNote = c.invoice_sent_at ? '<div class="cell-faint" style="margin-top:2px;">Invoice sent ' + fmtTime(c.invoice_sent_at) + '</div>' : "";
      return "<tr><td class=\"mono cell-primary\">" + esc(c.id) + "</td><td>" + esc(c.customer_name || "—") + "</td><td>" + brandCell + "</td>" +
        '<td class="cell-faint">' + esc(c.product_title) + "</td><td>" + photosCell + "</td><td><span class=\"chip " + chipClass + "\">" + label + "</span></td>" +
        '<td class="cell-faint mono">' + fmtTime(c.updated_at) + "</td><td>" + actions + invoiceNote + "</td></tr>";
    }).join("") || '<tr><td colspan="8" class="empty-note">' + (claimsCache.length ? "No claims match this filter." : "No claims yet.") + '</td></tr>';
  }

  function loadClaims() {
    return fetch("/api/ops/claims").then(function (r) { return r.json(); }).then(function (claims) {
      claimsCache = claims;
      renderClaims();
    });
  }

  statusFilter.addEventListener("change", renderClaims);
  claimSearch.addEventListener("input", renderClaims);

  window.__advance = function (id) {
    fetch("/api/ops/claims/" + encodeURIComponent(id) + "/advance", { method: "POST" })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { toast("Couldn't advance claim", res.body.error || ""); return; }
        toast("Status update sent", id + " → " + stageTitleFor(res.body.stage, res.body.routing_type).toLowerCase());
        loadClaims();
      });
  };

  window.__route = function (id, brandName) {
    if (!brandName) return;
    fetch("/api/ops/claims/" + encodeURIComponent(id) + "/route", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandName: brandName }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { toast("Couldn't route claim", res.body.error || ""); return; }
        toast("Routed by a teammate", id + " sent to " + brandName + "'s warranty team");
        loadClaims();
      });
  };

  window.__sendToBrand = function (id) {
    fetch("/api/ops/claims/" + encodeURIComponent(id) + "/send-to-brand", { method: "POST" })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { toast("Couldn't send to brand", res.body.error || ""); return; }
        var extra = res.body.invoice_sent_at ? " (including the purchase invoice)" : "";
        toast("Sent to brand", id + "'s details were emailed to " + res.body.brand_name + extra);
        loadClaims();
      })
      .catch(function () { toast("Couldn't send to brand", "Could not reach the server."); });
  };

  window.__sendInvoice = function (id) {
    fetch("/api/ops/claims/" + encodeURIComponent(id) + "/invoice", { method: "POST" })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { toast("Couldn't send invoice", res.body.error || ""); return; }
        toast("Invoice sent", id + "'s purchase invoice was emailed to the brand");
        loadClaims();
      })
      .catch(function () { toast("Couldn't send invoice", "Could not reach the server."); });
  };

  window.__editClaim = function (id) {
    var c = claimsCache.find(function (x) { return x.id === id; });
    if (!c) return;
    var brandOptions = '<option value="">Unmatched / flagged</option>' +
      brandsCache.map(function (b) { return '<option value="' + esc(b.name) + '"' + (b.name === c.brand_name ? " selected" : "") + '>' + esc(b.name) + "</option>"; }).join("");
    var stageOptions = ALL_STAGES.map(function (s) { return '<option value="' + s + '"' + (s === c.stage ? " selected" : "") + '>' + STAGE_LABEL[s] + "</option>"; }).join("");
    openModal(
      '<h3>Edit claim — ' + esc(c.id) + '</h3>' +
      '<div class="field"><label for="mProduct">Product</label><input id="mProduct" type="text" value="' + esc(c.product_title || "") + '"></div>' +
      '<div class="field"><label for="mSku">SKU</label><input id="mSku" type="text" value="' + esc(c.sku || "") + '"></div>' +
      '<div class="field"><label for="mIssue">Issue</label><textarea id="mIssue" style="min-height:80px;">' + esc(c.issue || "") + '</textarea></div>' +
      '<div class="field"><label for="mBrand">Brand</label><select id="mBrand">' + brandOptions + '</select></div>' +
      '<div class="field" style="margin-bottom:0;"><label for="mStage">Stage</label><select id="mStage">' + stageOptions + '</select></div>' +
      '<div class="card-hint" style="margin-top:10px;margin-bottom:0;">Saving here corrects the record directly — it does not send an email. Use "Simulate response" or "Route to…" on the queue for actions that notify someone.</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" onclick="window.__closeModal()">Cancel</button><button class="btn btn-primary" id="mSaveClaimBtn">Save</button></div>'
    );
    document.getElementById("mSaveClaimBtn").addEventListener("click", function () {
      var payload = {
        productTitle: document.getElementById("mProduct").value.trim(),
        sku: document.getElementById("mSku").value.trim(),
        issue: document.getElementById("mIssue").value.trim(),
        brandName: document.getElementById("mBrand").value,
        stage: document.getElementById("mStage").value,
      };
      fetch("/api/ops/claims/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
          if (!res.ok) { toast("Couldn't save claim", res.body.error || ""); return; }
          toast("Claim updated", id + " was saved");
          closeModal();
          loadClaims();
        })
        .catch(function () { toast("Couldn't save claim", "Could not reach the server."); });
    });
  };

  window.__viewPhotos = function (id) {
    fetch("/api/ops/claims/" + encodeURIComponent(id) + "/photos")
      .then(function (r) { return r.json(); })
      .then(function (photos) {
        var grid = photos.map(function (p) {
          var url = "/api/ops/claims/" + encodeURIComponent(id) + "/photos/" + p.id;
          return '<a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt="' + esc(p.filename || "photo") + '"></a>';
        }).join("");
        openModal(
          '<h3>Photos — ' + esc(id) + '</h3>' +
          '<div class="photo-grid">' + (grid || '<div class="empty-note">No photos.</div>') + '</div>' +
          '<div class="modal-actions"><button class="btn btn-ghost" onclick="window.__closeModal()">Close</button></div>'
        );
      });
  };

  Promise.all([loadBrandsForDropdowns()]).then(loadClaims);
  setInterval(loadClaims, 15000);
})();
