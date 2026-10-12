import { runtimeApiMappings } from './runtime'
import type { ScormVersion } from './scorm-version'

/**
 * Dev-mock-only completion status allowed-values. Every other field of the
 * version API shape (method and CMI element names) is derived from the shared
 * `runtimeApiMappings` so the mock cannot install names the runtime would not
 * discover. The production runtime never sees these statuses.
 */
const previewCompletionStatuses: Record<ScormVersion, readonly string[]> = {
  '1.2': ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'],
  '2004': ['completed', 'incomplete', 'not attempted', 'unknown']
}

/** Projects one `runtimeApiMappings` entry into the shape the mock script reads. */
function previewApiDefinition(version: ScormVersion) {
  const mapping = runtimeApiMappings[version]
  return {
    name: mapping.discoveryProperty,
    initialize: mapping.initialize,
    getValue: mapping.getValue,
    setValue: mapping.setValue,
    commit: mapping.commit,
    terminate: mapping.terminate,
    completionElement: mapping.completion.element,
    locationElement: mapping.location,
    sessionTimeElement: mapping.sessionTime,
    totalTimeElement: mapping.totalTime,
    statuses: previewCompletionStatuses[version]
  }
}

const previewApiDefinitions = {
  '1.2': previewApiDefinition('1.2'),
  '2004': previewApiDefinition('2004')
}

/** Local-preview-only LMS API. Production SCORM archives never include this script. */
export const scormDevMock = `;(function () {
  window.__SCORM_DEVTOOLS__ = true;

  var persistenceKey = "scorm-cli:preview:persist-cmi";
  var stateKey = "scorm-cli:preview:cmi-state";
  var versionKey = "scorm-cli:preview:scorm-version";
  var persistenceEnabled = false;

  // The preview mock owns the active SCORM version. It installs exactly one
  // learner API global (with that version's method names) so the injected
  // runtime, which discovers the API by property name, always binds to the
  // matching version. Both variants persist the same generic \`cmi.*\` string
  // values, so the only version-specific behavior is the API shape below. The
  // method and CMI element names are serialized from \`runtimeApiMappings\`, so
  // only the dev-only status allowed-values are defined here.
  var apiDefinitions = ${JSON.stringify(previewApiDefinitions)};

  // Dev-only diagnostics. Every event is written straight to the browser
  // console and never buffered, so the full, uncapped stream is always visible.
  function emit(name, details) {
    if (window.__SCORM_DEVTOOLS__ !== true) return;
    var event = { name: name, at: Date.now(), details: details || {} };
    try {
      if (window.console && typeof window.console.debug === "function") {
        window.console.debug("[scorm]", event);
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

  /** Only the two supported versions are valid; anything else falls back to 1.2. */
  function normalizeVersion(value) {
    return value === "2004" ? "2004" : "1.2";
  }

  var initialized = false;
  var finished = false;
  var values = Object.create(null);
  var cmiListeners = [];

  function getCmiSnapshot() {
    var snapshot = {};
    Object.keys(values).forEach(function (key) {
      snapshot[key] = values[key];
    });
    return snapshot;
  }

  function notifyCmiListeners() {
    cmiListeners.slice().forEach(function (listener) {
      try { listener(getCmiSnapshot()); } catch (_) {}
    });
  }

  function resetApiState(version) {
    initialized = false;
    finished = false;
    values = Object.create(null);
    var definition = apiDefinitions[version];
    values[definition.completionElement] = "";
    values[definition.locationElement] = "";
    values[definition.totalTimeElement] = version === "2004" ? "PT0S" : "0000:00:00.00";
    notifyCmiListeners();
  }

  function isCmiStringEntry(key, value) {
    return typeof key === "string" && key.indexOf("cmi.") === 0 && key.length > 4 &&
      typeof value === "string";
  }

  function durationCentiseconds(value) {
    if (typeof value !== "string") return 0;
    var match = value.match(/^(\\d+):(\\d{2}):(\\d{2})(?:\\.(\\d{1,2}))?$/);
    if (match) {
      var fraction = match[4] || "0";
      return ((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 100) + Number((fraction + "0").slice(0, 2));
    }
    match = value.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+(?:\\.\\d+)?)S)?$/);
    if (match) {
      var totalSeconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
      return isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds * 100) : 0;
    }
    return 0;
  }

  function formatDuration(centiseconds, version) {
    var total = Math.max(0, Math.round(centiseconds));
    var hours = Math.floor(total / 360000);
    var minutes = Math.floor((total % 360000) / 6000);
    var seconds = Math.floor((total % 6000) / 100);
    var fraction = total % 100;
    if (version === "1.2") {
      return String(hours).padStart(4, "0") + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + String(fraction).padStart(2, "0");
    }
    var secondsText = fraction ? String(seconds) + "." + String(fraction).padStart(2, "0") : String(seconds);
    var duration = (hours ? String(hours) + "H" : "") + (minutes ? String(minutes) + "M" : "") + ((seconds || fraction) ? secondsText + "S" : "");
    return "PT" + (duration || "0S");
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

  function clearSavedState() {
    var storage = getStorage("clear-state");
    if (!storage) return;
    try {
      storage.removeItem(stateKey);
    } catch (error) {
      storageError("clear-state", error);
    }
  }

  /**
   * Replaces the learner API global with the one for \`version\`, deleting the
   * opposite global so a stale API can never be discovered after a switch.
   */
  function installApi(version) {
    try { delete window.API; } catch (_) {}
    try { delete window.API_1484_11; } catch (_) {}
    var definition = apiDefinitions[version];
    var api = {};
    api[definition.initialize] = function (parameter) {
      if (version !== activeVersion) return "false";
      if (parameter !== "" || initialized || finished) return "false";
      values[definition.sessionTimeElement] = formatDuration(0, version);
      initialized = true;
      persistState("initialize");
      notifyCmiListeners();
      return "true";
    };
    api[definition.getValue] = function (key) {
      if (version !== activeVersion) return "";
      if (!initialized || finished || !Object.prototype.hasOwnProperty.call(values, key)) return "";
      return values[key];
    };
    api[definition.setValue] = function (key, value) {
      if (version !== activeVersion) return "false";
      if (!initialized || finished || !isCmiStringEntry(key, value)) return "false";
      if (key === "cmi.core.total_time" || key === "cmi.total_time") return "false";
      if (key === definition.completionElement && definition.statuses.indexOf(value) < 0) return "false";
      values[key] = value;
      persistState("set-value");
      notifyCmiListeners();
      return "true";
    };
    api[definition.commit] = function (parameter) {
      if (version !== activeVersion) return "false";
      if (!initialized || finished || parameter !== "") return "false";
      persistState("commit");
      return "true";
    };
    api[definition.terminate] = function (parameter) {
      if (version !== activeVersion) return "false";
      if (!initialized || finished || parameter !== "") return "false";
      var prior = durationCentiseconds(values[definition.totalTimeElement]);
      var session = durationCentiseconds(values[definition.sessionTimeElement]);
      values[definition.totalTimeElement] = formatDuration(prior + session, version);
      finished = true;
      persistState("terminate");
      notifyCmiListeners();
      return "true";
    };
    window[definition.name] = api;
  }

  // The version preference survives reloads and content hot-reloads; the mock
  // re-reads it on every script evaluation so the injected runtime initializes
  // against the matching API.
  var versionStorage = getStorage("read-version");
  var storedVersion = null;
  if (versionStorage) {
    try {
      storedVersion = versionStorage.getItem(versionKey);
    } catch (error) {
      storageError("read-version", error);
    }
  }
  var activeVersion = normalizeVersion(storedVersion);
  if (versionStorage) {
    try {
      versionStorage.setItem(versionKey, activeVersion);
    } catch (error) {
      storageError("set-version", error);
    }
  }
  resetApiState(activeVersion);

  var startupStorage = getStorage("read-preference");
  if (startupStorage) {
    var storedPreference = null;
    try {
      storedPreference = startupStorage.getItem(persistenceKey);
    } catch (error) {
      storageError("read-preference", error);
    }

    if (storedPreference === null) {
      persistenceEnabled = true;
      try {
        startupStorage.setItem(persistenceKey, "true");
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
              if ((key === "cmi.core.total_time" || key === "cmi.total_time") && key !== apiDefinitions[activeVersion].totalTimeElement) return;
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
  // Restoration is a complete CMI state replacement from the inspector's
  // perspective, even when storage is unavailable or contains no saved state.
  notifyCmiListeners();

  function reloadPage() {
    try {
      if (window.location && typeof window.location.reload === "function") {
        window.location.reload();
      }
    } catch (_) {}
  }

  /**
   * Switches the preview to \`version\`. Selecting the active version is a
   * no-op; otherwise the active bridge is finished, the raw CMI state is
   * cleared, the API global is replaced and the page reloads so the injected
   * runtime recreates itself deterministically against the matching API.
   */
  function setScormVersion(version) {
    var next = normalizeVersion(version);
    if (next === activeVersion) return;

    try {
      var bridge = window.scormBridge;
      if (bridge && typeof bridge.finish === "function") bridge.finish();
    } catch (_) {}

    activeVersion = next;
    var storage = getStorage("set-version");
    if (storage) {
      try {
        storage.setItem(versionKey, activeVersion);
      } catch (error) {
        storageError("set-version", error);
      }
    }
    resetApiState(activeVersion);
    clearSavedState();
    installApi(activeVersion);
    window.__SCORM_PREVIEW_VERSION__ = activeVersion;
    emit("lms.version-changed", {
      version: activeVersion,
      api: apiDefinitions[activeVersion].name
    });
    reloadPage();
  }

  window.scormDevTools = {
    getCmiSnapshot: getCmiSnapshot,
    subscribeToCmi: function (listener) {
      if (typeof listener !== "function") return function () {};
      cmiListeners.push(listener);
      try { listener(getCmiSnapshot()); } catch (_) {}
      return function () {
        var index = cmiListeners.indexOf(listener);
        if (index >= 0) cmiListeners.splice(index, 1);
      };
    },
    getCmiPersistenceEnabled: function () {
      return persistenceEnabled;
    },
    setCmiPersistenceEnabled: function (enabled) {
      persistenceEnabled = enabled === true;
      var storage = getStorage("set-preference");
      if (storage) {
        if (persistenceEnabled) {
          try {
            storage.setItem(persistenceKey, "true");
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
            storage.setItem(persistenceKey, "false");
          } catch (error) {
            storageError("set-preference", error);
          }
        }
      }
      if (persistenceEnabled) persistState("save-state");
    },
    getScormVersion: function () {
      return activeVersion;
    },
    getApiName: function () {
      return apiDefinitions[activeVersion].name;
    },
    setScormVersion: setScormVersion
  };

  installApi(activeVersion);
  window.__SCORM_PREVIEW_VERSION__ = activeVersion;
})();`
