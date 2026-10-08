import type { ContentManifest } from './content-manifest';
import { browserCodecSource } from './state-codec';

const emptyManifest: ContentManifest = {
  schemaVersion: 1,
  title: '',
  lang: 'en',
  presentation: 'scroll',
  pages: {},
};

/** Creates the SCO bridge with the same dictionary written into the package. */
export function createScormRuntime(manifest: ContentManifest): string {
  const dictionary = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `;(function () {
  var CONTENT_MANIFEST = ${dictionary};
  var api = null;
  var finished = false;
  var initialized = false;
  var alreadyComplete = false;
  var currentLocation = "";
  var resumeState = { pages: {} };

  function emit(name, details) {
    if (window.__SCORM_DEVTOOLS__ !== true) return;
    var event = { name: name, at: Date.now(), details: details || {} };
    try {
      if (window.console && typeof window.console.log === "function") {
        window.console.log("[scorm] " + name, event);
      }
    } catch (_) {}
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
${browserCodecSource()}

  function progressFor(state) {
    var entries = Object.keys(CONTENT_MANIFEST.pages).map(function (key) { return CONTENT_MANIFEST.pages[key]; });
    if (!entries.length) return 0;
    var done = entries.reduce(function (count, page) {
      var value = state && state.pages && state.pages[page.id];
      var complete = CONTENT_MANIFEST.presentation === "scroll"
        ? value && value.completed === true
        : value && value.visited === true;
      return count + (complete ? 1 : 0);
    }, 0);
    return Math.max(0, Math.min(100, Math.round(done * 100 / entries.length)));
  }

  function findApi(start) {
    var current = start;
    for (var i = 0; current && i < 8; i++) {
      try {
        if (current.API && typeof current.API === "object") return current.API;
        if (!current.parent || current.parent === current) break;
        current = current.parent;
      } catch (_) { break; }
    }
    return null;
  }

  try { api = findApi(window); } catch (_) {}
  if (!api) { try { api = findApi(window.opener); } catch (_) {} }
  if (window.__SCORM_DEVTOOLS__ === true) {
    emit(api ? "lms.api-found" : "lms.api-missing", api ? {} : { reason: "api-not-found" });
  }

  function call(name, eventName, key, value, secondValue) {
    var details = window.__SCORM_DEVTOOLS__ === true ? { method: name } : null;
    var eventValue = secondValue === undefined ? value : secondValue;
    if (details && key !== undefined) details.key = key;
    // For reads the payload is only known after the LMS responds, so value
    // and length are populated on success below. Writes report the attempted
    // value up front even when the LMS later rejects it.
    if (details && eventValue !== undefined && eventName !== "lms.get-value") {
      details.value = eventValue;
      if (key === "cmi.suspend_data") details.length = String(eventValue).length;
    }
    if (!api) {
      if (details) details.reason = "api-not-found";
      emit(eventName, details);
      return "";
    }
    if (typeof api[name] !== "function") {
      if (details) details.reason = "method-unavailable";
      emit(eventName, details);
      return "";
    }
    try {
      var result = secondValue === undefined
        ? api[name](value == null ? "" : String(value))
        : api[name](String(value), String(secondValue));
      result = result == null ? "" : String(result);
      if (details) {
        details.result = result;
        if (eventName === "lms.get-value") {
          details.value = result;
          if (key === "cmi.suspend_data") details.length = result.length;
        }
      }
      emit(eventName, details);
      return result;
    } catch (error) {
      if (details) {
        details.result = "";
        details.error = error && error.message ? String(error.message) : String(error);
      }
      emit(eventName, details);
      return "";
    }
  }

  initialized = call("LMSInitialize", "lms.initialize", undefined, "") === "true";
  if (initialized) {
    var status = call("LMSGetValue", "lms.get-value", "cmi.core.lesson_status", "cmi.core.lesson_status");
    alreadyComplete = status === "completed" || status === "passed";
    currentLocation = call("LMSGetValue", "lms.get-value", "cmi.core.lesson_location", "cmi.core.lesson_location");
    resumeState = compactDecode(CONTENT_MANIFEST, call("LMSGetValue", "lms.get-value", "cmi.suspend_data", "cmi.suspend_data"));
    resumeState.location = currentLocation;
    if (!alreadyComplete) call("LMSSetValue", "lms.set-value", "cmi.core.lesson_status", "cmi.core.lesson_status", "incomplete");
    call("LMSCommit", "lms.commit", undefined, "");
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (!initialized) {
      if (window.__SCORM_DEVTOOLS__ === true) emit("lms.finish", { method: "LMSFinish", reason: api ? "not-initialized" : "api-not-found" });
      return;
    }
    if (!alreadyComplete) call("LMSSetValue", "lms.set-value", "cmi.core.exit", "cmi.core.exit", "suspend");
    call("LMSCommit", "lms.commit", undefined, "");
    call("LMSFinish", "lms.finish", undefined, "");
  }

  function restoreState() {
    if (!api || !initialized) return { pages: {} };
    var restored = compactDecode(CONTENT_MANIFEST, compactEncode(CONTENT_MANIFEST, resumeState, progressFor(resumeState)));
    restored.location = currentLocation;
    return restored;
  }

  window.scormBridge = {
    getLocation: function () {
      if (!api || !initialized) return "";
      return currentLocation;
    },
    restoreState: restoreState,
    getResumeState: restoreState,
    saveState: function (state) {
      if (!api || !initialized) return false;
      var serialized = compactEncode(CONTENT_MANIFEST, state, progressFor(state));
      var normalized = compactDecode(CONTENT_MANIFEST, serialized);
      var saved = true;
      if (state && typeof state.location === "string") {
        currentLocation = state.location;
        normalized.location = currentLocation;
        if (call("LMSSetValue", "lms.set-value", "cmi.core.lesson_location", "cmi.core.lesson_location", currentLocation) !== "true") saved = false;
      }
      // SCORM 1.2 recommends a 4096-character limit for cmi.suspend_data.
      if (serialized.length > 4096) {
        emit("lms.suspend-data-too-large", { length: serialized.length, limit: 4096 });
        saved = false;
      } else if (call("LMSSetValue", "lms.set-value", "cmi.suspend_data", "cmi.suspend_data", serialized) !== "true") {
        saved = false;
      }
      resumeState = normalized;
      if (call("LMSCommit", "lms.commit", undefined, "") !== "true") saved = false;
      return saved;
    },
    markCompleted: function () {
      if (!api || !initialized || alreadyComplete) return;
      if (call("LMSSetValue", "lms.set-value", "cmi.core.lesson_status", "cmi.core.lesson_status", "completed") === "true") {
        call("LMSCommit", "lms.commit", undefined, "");
        alreadyComplete = true;
      }
    },
    finish: finish
  };

  if (window.addEventListener) window.addEventListener("beforeunload", finish, false);
})();`;
}

/** Empty-dictionary compatibility export; packages should call createScormRuntime. */
export const scormRuntime = createScormRuntime(emptyManifest);
