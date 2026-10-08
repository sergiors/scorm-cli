/** Local-preview-only LMS API. Production SCORM archives never include this script. */
export const scormDevMock = `;(function () {
  window.__SCORM_DEVTOOLS__ = true;

  var preferenceKey = "scorm-cli:dev:persist-cmi";
  var stateKey = "scorm-cli:dev:cmi-state";
  var persistenceEnabled = false;

  // Dev-only diagnostics. Every event is written straight to the browser
  // console and never buffered, so the full, uncapped stream is always visible.
  function emit(name, details) {
    if (window.__SCORM_DEVTOOLS__ !== true) return;
    var event = { name: name, at: Date.now(), details: details || {} };
    try {
      if (window.console && typeof window.console.log === "function") {
        window.console.log("[scorm] " + name, event);
      }
    } catch (_) {}
  }

  function storageError(operation, error) {
    emit("cmi.persistence-error", {
      operation: operation,
      error: error && error.message ? String(error.message) : String(error)
    });
  }

  function getStorage(operation) {
    try {
      return window.localStorage || null;
    } catch (error) {
      storageError(operation, error);
      return null;
    }
  }

  var initialized = false;
  var finished = false;
  var values = Object.create(null);
  values["cmi.core.lesson_status"] = "";
  values["cmi.core.lesson_location"] = "";

  function isCmiStringEntry(key, value) {
    return typeof key === "string" && key.indexOf("cmi.") === 0 && key.length > 4 &&
      typeof value === "string";
  }

  function persistState(operation) {
    if (!persistenceEnabled) return;
    var storage = getStorage(operation);
    if (!storage) return;
    var cmi = Object.create(null);
    Object.keys(values).forEach(function (key) {
      if (isCmiStringEntry(key, values[key])) cmi[key] = values[key];
    });
    try {
      storage.setItem(stateKey, JSON.stringify(cmi));
    } catch (error) {
      storageError(operation, error);
    }
  }

  window.scormDevTools = {
    getCmiPersistenceEnabled: function () {
      return persistenceEnabled;
    },
    setCmiPersistenceEnabled: function (enabled) {
      persistenceEnabled = enabled === true;
      var storage = getStorage("set-preference");
      if (storage) {
        if (persistenceEnabled) {
          try {
            storage.setItem(preferenceKey, "true");
          } catch (error) {
            storageError("set-preference", error);
          }
        } else {
          try {
            storage.removeItem(stateKey);
          } catch (error) {
            storageError("clear-state", error);
          }
          try {
            storage.setItem(preferenceKey, "false");
          } catch (error) {
            storageError("set-preference", error);
          }
        }
      }
      if (persistenceEnabled) persistState("save-state");
    }
  };

  var startupStorage = getStorage("read-preference");
  if (startupStorage) {
    var storedPreference = null;
    try {
      storedPreference = startupStorage.getItem(preferenceKey);
    } catch (error) {
      storageError("read-preference", error);
    }

    if (storedPreference === null) {
      persistenceEnabled = true;
      try {
        startupStorage.setItem(preferenceKey, "true");
      } catch (error) {
        storageError("set-preference", error);
      }
    } else {
      persistenceEnabled = storedPreference === "true";
    }

    if (!persistenceEnabled) {
      try {
        startupStorage.removeItem(stateKey);
      } catch (error) {
        storageError("clear-state", error);
      }
    } else {
      try {
        var saved = startupStorage.getItem(stateKey);
        if (saved !== null) {
          var restored = JSON.parse(saved);
          var count = 0;
          if (restored && typeof restored === "object" && !Array.isArray(restored)) {
            Object.keys(restored).forEach(function (key) {
              if (!isCmiStringEntry(key, restored[key])) return;
              values[key] = restored[key];
              count++;
            });
          }
          emit("cmi.persistence-restored", { count: count });
        }
      } catch (error) {
        storageError("restore-state", error);
      }
    }
  }

  var validStatuses = ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"];

  window.API = {
    LMSInitialize: function (parameter) {
      if (parameter !== "" || initialized || finished) return "false";
      initialized = true;
      return "true";
    },
    LMSGetValue: function (key) {
      if (!initialized || finished || !Object.prototype.hasOwnProperty.call(values, key)) return "";
      return values[key];
    },
    LMSSetValue: function (key, value) {
      if (!initialized || finished || !isCmiStringEntry(key, value)) return "false";
      if (key === "cmi.core.lesson_status" && validStatuses.indexOf(value) < 0) return "false";
      values[key] = value;
      persistState("set-value");
      return "true";
    },
    LMSCommit: function (parameter) {
      if (!initialized || finished || parameter !== "") return "false";
      persistState("commit");
      return "true";
    },
    LMSFinish: function (parameter) {
      if (!initialized || finished || parameter !== "") return "false";
      finished = true;
      return "true";
    }
  };
})();`;
