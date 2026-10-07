export const scormRuntime = `;(function () {
  var api = null;
  var finished = false;
  var initialized = false;
  var alreadyComplete = false;

  function findApi(start) {
    var current = start;
    for (var i = 0; current && i < 8; i++) {
      try {
        if (current.API && typeof current.API.LMSInitialize === "function") return current.API;
        if (!current.parent || current.parent === current) break;
        current = current.parent;
      } catch (_) { break; }
    }
    return null;
  }

  try { api = findApi(window); } catch (_) {}
  if (!api) { try { api = findApi(window.opener); } catch (_) {} }

  function call(name, value, secondValue) {
    if (!api || typeof api[name] !== "function") return "";
    try {
      return secondValue === undefined
        ? api[name](value == null ? "" : String(value))
        : api[name](String(value), String(secondValue));
    } catch (_) { return ""; }
  }

  if (api) {
    initialized = call("LMSInitialize", "") === "true";
    if (initialized) {
      var status = call("LMSGetValue", "cmi.core.lesson_status");
      alreadyComplete = status === "completed" || status === "passed";
      if (!alreadyComplete) call("LMSSetValue", "cmi.core.lesson_status", "incomplete");
      call("LMSCommit", "");
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (!api || !initialized) return;
    call("LMSCommit", "");
    call("LMSFinish", "");
  }

  window.courseRuntime = {
    markCompleted: function () {
      if (!api || !initialized || alreadyComplete) return;
      if (call("LMSSetValue", "cmi.core.lesson_status", "completed") === "true") {
        call("LMSCommit", "");
        alreadyComplete = true;
      }
    },
    finish: finish
  };

  if (window.addEventListener) window.addEventListener("beforeunload", finish, false);
})();`;
