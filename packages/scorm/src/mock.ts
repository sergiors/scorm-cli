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

  /** Only the two supported versions are valid; anything else falls back to 1.2. */
  function normalizeVersion(value) {
    return value === "2004" ? "2004" : "1.2";
  }

  var initialized = false;
  var finished = false;
  var values = Object.create(null);

  function resetApiState(version) {
    initialized = false;
    finished = false;
    values = Object.create(null);
    var definition = apiDefinitions[version];
    values[definition.completionElement] = "";
    values[definition.locationElement] = "";
  }

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
      if (parameter !== "" || initialized || finished) return "false";
      initialized = true;
      return "true";
    };
    api[definition.getValue] = function (key) {
      if (!initialized || finished || !Object.prototype.hasOwnProperty.call(values, key)) return "";
      return values[key];
    };
    api[definition.setValue] = function (key, value) {
      if (!initialized || finished || !isCmiStringEntry(key, value)) return "false";
      if (key === definition.completionElement && definition.statuses.indexOf(value) < 0) return "false";
      values[key] = value;
      persistState("set-value");
      return "true";
    };
    api[definition.commit] = function (parameter) {
      if (!initialized || finished || parameter !== "") return "false";
      persistState("commit");
      return "true";
    };
    api[definition.terminate] = function (parameter) {
      if (!initialized || finished || parameter !== "") return "false";
      finished = true;
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
