(function () {
  var brandsCache = [];

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
  function toast(title, body) {
    var stack = document.getElementById("toastStack");
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = "<div><b>" + esc(title) + "</b><span>" + esc(body || "") + "</span></div>";
    stack.appendChild(el);
    setTimeout(function () { el.classList.add("leaving"); setTimeout(function () { el.remove(); }, 200); }, 4200);
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
    return fetch("/api/ops/brands").then(function (r) { return r.json(); }).then(function (brands) {
      brandsCache = brands;
      document.getElementById("brandTableBody").innerHTML = brands.map(function (b) {
        return "<tr><td class=\"cell-primary\">" + esc(b.name) + (b.house ? '<span class="tag tag-house">In-house</span>' : "") + "</td>" +
          '<td class="num mono">' + Number(b.units_sold).toLocaleString() + "</td>" +
          '<td class="cell-faint">' + (b.house ? "Internal QC queue" : "External email") + "</td>" +
          "<td>" + (b.house ? '<span class="cell-faint">—</span>' : esc(b.contact_role || "—") + '<span class="cell-faint mono" style="display:block;font-size:11.5px;">' + esc(b.contact_email || "no email set") + "</span>") + "</td>" +
          "<td>" + (b.house ? "" : '<button class="link-btn" onclick="window.__editBrand(' + jsAttr(b.name) + ')">Edit</button>') + "</td></tr>";
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

  Promise.all([loadBrands(), loadTemplate()]);
})();
