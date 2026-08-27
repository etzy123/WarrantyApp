(function () {
  var STAGE_CHIP = { submitted: "chip-submitted", routed: "chip-routed", processing: "chip-processing", resolved: "chip-resolved", attention: "chip-attention" };
  var brandsCache = [];

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

  function loadBrands() {
    return fetch("/api/brands").then(function (r) { return r.json(); }).then(function (brands) {
      brandsCache = brands;
      document.getElementById("brandTableBody").innerHTML = brands.map(function (b) {
        return "<tr><td class=\"cell-primary\">" + esc(b.name) + (b.house ? '<span class="tag tag-house">In-house</span>' : "") + "</td>" +
          '<td class="num mono">' + Number(b.units_sold).toLocaleString() + "</td>" +
          '<td class="cell-faint">' + (b.house ? "Internal QC queue" : "External email") + "</td>" +
          "<td>" + (b.house ? '<span class="cell-faint">—</span>' : esc(b.contact_role) + '<span class="cell-faint mono" style="display:block;font-size:11.5px;">' + esc(b.contact_email) + "</span>") + "</td></tr>";
      }).join("");
    });
  }

  function loadClaims() {
    return fetch("/api/ops/claims").then(function (r) { return r.json(); }).then(function (claims) {
      document.getElementById("queueCount").textContent = claims.length + " claim" + (claims.length === 1 ? "" : "s") + " in the pipeline";
      document.getElementById("queueTableBody").innerHTML = claims.map(function (c) {
        var chipClass = STAGE_CHIP[c.stage];
        var label = stageTitleFor(c.stage, c.routing_type);
        var canAdvance = c.stage !== "resolved" && c.stage !== "attention";
        var brandCell = c.routing_type === "ambiguous"
          ? '<span class="cell-faint">Unmatched</span><span class="tag tag-flag">Flagged</span>'
          : esc(c.brand_name) + (c.routing_type === "house" ? '<span class="tag tag-house">In-house</span>' : "");
        var actions = "";
        if (canAdvance) actions += '<button class="btn btn-ghost btn-small" onclick="window.__advance(\'' + c.id + '\')">Simulate response</button> ';
        if (c.stage === "attention") {
          actions += '<select onchange="window.__route(\'' + c.id + '\', this.value)" style="width:auto;display:inline-block;">' +
            '<option value="">Route to…</option>' +
            brandsCache.filter(function (b) { return !b.house; }).map(function (b) { return '<option value="' + esc(b.name) + '">' + esc(b.name) + "</option>"; }).join("") +
            "</select>";
        }
        return "<tr><td class=\"mono cell-primary\">" + esc(c.id) + "</td><td>" + esc(c.customer_name || "—") + "</td><td>" + brandCell + "</td>" +
          '<td class="cell-faint">' + esc(c.product_title) + "</td><td><span class=\"chip " + chipClass + "\">" + label + "</span></td>" +
          '<td class="cell-faint mono">' + fmtTime(c.updated_at) + "</td><td>" + actions + "</td></tr>";
      }).join("") || '<tr><td colspan="7" class="empty-note">No claims yet.</td></tr>';
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

  loadBrands().then(loadClaims);
  setInterval(loadClaims, 15000);
})();
