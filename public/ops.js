(function () {
  var STAGE_CHIP = { submitted: "chip-submitted", routed: "chip-routed", processing: "chip-processing", resolved: "chip-resolved", attention: "chip-attention" };
  var STAGE_LABEL = { submitted: "Submitted", routed: "Routed", processing: "Processing", resolved: "Resolved", attention: "Needs routing" };
  var ALL_STAGES = ["submitted", "routed", "processing", "resolved", "attention"];
  var brandsCache = [];
  var claimsCache = [];

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

  // ---------- brand directory ----------
  function loadBrands() {
    return fetch("/api/brands").then(function (r) { return r.json(); }).then(function (brands) {
      brandsCache = brands;
      document.getElementById("brandTableBody").innerHTML = brands.map(function (b) {
        return "<tr><td class=\"cell-primary\">" + esc(b.name) + (b.house ? '<span class="tag tag-house">In-house</span>' : "") + "</td>" +
          '<td class="num mono">' + Number(b.units_sold).toLocaleString() + "</td>" +
          '<td class="cell-faint">' + (b.house ? "Internal QC queue" : "External email") + "</td>" +
          "<td>" + (b.house ? '<span class="cell-faint">—</span>' : esc(b.contact_role || "—") + '<span class="cell-faint mono" style="display:block;font-size:11.5px;">' + esc(b.contact_email || "no email set") + "</span>") + "</td>" +
          "<td>" + (b.house ? "" : '<button class="link-btn" onclick="window.__editBrand(' + JSON.stringify(b.name) + ')">Edit</button>') + "</td></tr>";
      }).join("");
    });
  }

  window.__editBrand = function (name) {
    var b = brandsCache.find(function (x) { return x.name === name; });
    if (!b) return;
    openModal(
      '<h3>Edit contact — ' + esc(b.name) + '</h3>' +
      '<div class="field"><label for="mRole">Contact role</label><input id="mRole" type="text" value="' + esc(b.contact_role || "") + '" placeholder="e.g. Warranty Support"></div>' +
      '<div class="field" style="margin-bottom:0;"><label for="mEmail">Contact email</label><input id="mEmail" type="email" value="' + esc(b.contact_email || "") + '" placeholder="warranty@brand.com"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" onclick="window.__closeModal()">Cancel</button><button class="btn btn-primary" id="mSaveBtn">Save</button></div>'
    );
    document.getElementById("mSaveBtn").addEventListener("click", function () {
      var role = document.getElementById("mRole").value.trim();
      var email = document.getElementById("mEmail").value.trim();
      fetch("/api/ops/brands/" + encodeURIComponent(name), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactRole: role, contactEmail: email }),
      })
        .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        .then(function (res) {
          if (!res.ok) { toast("Couldn't save contact", res.body.error || ""); return; }
          toast("Contact updated", name + "'s warranty contact was saved");
          closeModal();
          loadBrands();
        })
        .catch(function () { toast("Couldn't save contact", "Could not reach the server."); });
    });
  };

  // ---------- email template ----------
  function loadTemplate() {
    return fetch("/api/ops/email-template").then(function (r) { return r.json(); }).then(function (t) {
      document.getElementById("tplSubject").value = t.subject || "";
      document.getElementById("tplBody").value = t.body || "";
    });
  }
  document.getElementById("tplSaveBtn").addEventListener("click", function () {
    var subject = document.getElementById("tplSubject").value.trim();
    var body = document.getElementById("tplBody").value.trim();
    if (!subject || !body) { toast("Couldn't save template", "Subject and body can't be empty."); return; }
    fetch("/api/ops/email-template", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject, body: body }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) { toast("Couldn't save template", res.body.error || ""); return; }
        toast("Template saved", "New brand claims will use this wording.");
      })
      .catch(function () { toast("Couldn't save template", "Could not reach the server."); });
  });

  // ---------- claims queue ----------
  function loadClaims() {
    return fetch("/api/ops/claims").then(function (r) { return r.json(); }).then(function (claims) {
      claimsCache = claims;
      document.getElementById("queueCount").textContent = claims.length + " claim" + (claims.length === 1 ? "" : "s") + " in the pipeline";
      document.getElementById("queueTableBody").innerHTML = claims.map(function (c) {
        var chipClass = STAGE_CHIP[c.stage];
        var label = stageTitleFor(c.stage, c.routing_type);
        var canAdvance = c.stage !== "resolved" && c.stage !== "attention";
        var brandCell = c.routing_type === "ambiguous"
          ? '<span class="cell-faint">Unmatched</span><span class="tag tag-flag">Flagged</span>'
          : esc(c.brand_name) + (c.routing_type === "house" ? '<span class="tag tag-house">In-house</span>' : "");
        var photosCell = c.photo_count > 0
          ? '<button class="photo-badge" onclick="window.__viewPhotos(' + JSON.stringify(c.id) + ')">' + c.photo_count + ' photo' + (c.photo_count === 1 ? "" : "s") + '</button>'
          : '<span class="cell-faint">—</span>';
        var actions = '<button class="btn btn-ghost btn-small" onclick="window.__editClaim(' + JSON.stringify(c.id) + ')">Edit</button> ';
        if (canAdvance) actions += '<button class="btn btn-ghost btn-small" onclick="window.__advance(\'' + c.id + '\')">Simulate response</button> ';
        if (c.stage === "attention") {
          actions += '<select onchange="window.__route(\'' + c.id + '\', this.value)" style="width:auto;display:inline-block;">' +
            '<option value="">Route to…</option>' +
            brandsCache.filter(function (b) { return !b.house; }).map(function (b) { return '<option value="' + esc(b.name) + '">' + esc(b.name) + "</option>"; }).join("") +
            "</select>";
        }
        return "<tr><td class=\"mono cell-primary\">" + esc(c.id) + "</td><td>" + esc(c.customer_name || "—") + "</td><td>" + brandCell + "</td>" +
          '<td class="cell-faint">' + esc(c.product_title) + "</td><td>" + photosCell + "</td><td><span class=\"chip " + chipClass + "\">" + label + "</span></td>" +
          '<td class="cell-faint mono">' + fmtTime(c.updated_at) + "</td><td>" + actions + "</td></tr>";
      }).join("") || '<tr><td colspan="8" class="empty-note">No claims yet.</td></tr>';
    });
  }

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

  Promise.all([loadBrands(), loadTemplate()]).then(loadClaims);
  setInterval(loadClaims, 15000);
})();
