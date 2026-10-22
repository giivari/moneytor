"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Eye, EyeSlash } from "@phosphor-icons/react";

const STORAGE_KEY = "moneytor.privacy.hideAmounts";
const PRIVACY_CHANGE_EVENT = "moneytor:privacy-change";
const CURRENCY_AMOUNT_RE =
  /([+−-]?\s*(?:Rp\s*|(?:IDR|USD|EUR|SGD|JPY|GBP|AUD|MYR|CNY|CHF|CAD|HKD|KRW|THB|SAR)\s+))[\d.,]+/g;

const maskedTextNodes = new WeakMap<Text, { original: string; masked: string }>();
const maskedTitleElements = new WeakMap<Element, { original: string; masked: string }>();

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return true;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "NOSCRIPT") {
    return true;
  }
  return Boolean(el.closest("[data-privacy-exempt='true']"));
}

function maskCurrencyString(input: string): string {
  return input.replace(CURRENCY_AMOUNT_RE, "$1••••••");
}

function applyPrivacyMask(root: Node) {
  if (typeof document === "undefined") return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (!shouldSkipElement(current.parentElement)) {
      const val = current.nodeValue ?? "";
      const existing = maskedTextNodes.get(current);
      if (!existing || val !== existing.masked) {
        CURRENCY_AMOUNT_RE.lastIndex = 0;
        if (CURRENCY_AMOUNT_RE.test(val)) {
          const masked = maskCurrencyString(val);
          maskedTextNodes.set(current, { original: val, masked });
          current.nodeValue = masked;
        }
      }
    }
    current = walker.nextNode() as Text | null;
  }

  if (root instanceof Element || root instanceof Document) {
    const titled = (root instanceof Document ? root.body : root)?.querySelectorAll("[title]") ?? [];
    titled.forEach((el) => {
      if (shouldSkipElement(el)) return;
      const val = el.getAttribute("title") ?? "";
      const existing = maskedTitleElements.get(el);
      if (!existing || val !== existing.masked) {
        CURRENCY_AMOUNT_RE.lastIndex = 0;
        if (CURRENCY_AMOUNT_RE.test(val)) {
          const masked = maskCurrencyString(val);
          maskedTitleElements.set(el, { original: val, masked });
          el.setAttribute("title", masked);
        }
      }
    });
  }
}

function restorePrivacyMask() {
  if (typeof document === "undefined" || !document.body) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  while (current) {
    const existing = maskedTextNodes.get(current);
    if (existing) {
      if (current.nodeValue === existing.masked) {
        current.nodeValue = existing.original;
      }
      maskedTextNodes.delete(current);
    }
    current = walker.nextNode() as Text | null;
  }

  const titled = document.body.querySelectorAll("[title]");
  titled.forEach((el) => {
    const existing = maskedTitleElements.get(el);
    if (existing) {
      if (el.getAttribute("title") === existing.masked) {
        el.setAttribute("title", existing.original);
      }
      maskedTitleElements.delete(el);
    }
  });
}

function subscribePrivacy(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(PRIVACY_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PRIVACY_CHANGE_EVENT, callback);
  };
}

function getPrivacySnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getPrivacyServerSnapshot(): boolean {
  return false;
}

export function PrivacyAmountToggle() {
  const pathname = usePathname();
  const hidden = useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getPrivacyServerSnapshot,
  );

  function togglePrivacy() {
    try {
      if (hidden) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, "1");
      }
    } catch {
      // Ignore storage errors in private browsing
    }
    window.dispatchEvent(new Event(PRIVACY_CHANGE_EVENT));
  }

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.setAttribute("data-privacy", "hidden");
      if (document.body) applyPrivacyMask(document.body);
    } else {
      root.removeAttribute("data-privacy");
      restorePrivacyMask();
    }
  }, [hidden, pathname]);

  useEffect(() => {
    if (!hidden || typeof document === "undefined" || !document.body) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) {
          const textNode = mutation.target as Text;
          if (!shouldSkipElement(textNode.parentElement)) {
            const val = textNode.nodeValue ?? "";
            const existing = maskedTextNodes.get(textNode);
            if (!existing || val !== existing.masked) {
              CURRENCY_AMOUNT_RE.lastIndex = 0;
              if (CURRENCY_AMOUNT_RE.test(val)) {
                const masked = maskCurrencyString(val);
                maskedTextNodes.set(textNode, { original: val, masked });
                textNode.nodeValue = masked;
              }
            }
          }
        } else if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const textNode = node as Text;
              if (!shouldSkipElement(textNode.parentElement)) {
                const val = textNode.nodeValue ?? "";
                CURRENCY_AMOUNT_RE.lastIndex = 0;
                if (CURRENCY_AMOUNT_RE.test(val)) {
                  const masked = maskCurrencyString(val);
                  maskedTextNodes.set(textNode, { original: val, masked });
                  textNode.nodeValue = masked;
                }
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              applyPrivacyMask(node);
            }
          });
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [hidden]);

  return (
    <button
      type="button"
      className="onboarding-help-trigger privacy-toggle-trigger"
      onClick={togglePrivacy}
      aria-pressed={hidden}
      aria-label={hidden ? "Tampilkan nominal uang" : "Sembunyikan nominal uang"}
      title={hidden ? "Tampilkan nominal uang" : "Sembunyikan nominal uang"}
    >
      {hidden ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
    </button>
  );
}

