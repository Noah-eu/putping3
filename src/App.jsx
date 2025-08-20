// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  ref,
  set,
  update,
  onValue,
  remove,
  push,
  serverTimestamp,
  get,
} from "firebase/database";
import {
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { db, auth, storage } from "./firebase.js";
import Sortable from "sortablejs";
import { spawnDevBot } from './devBot';
import { GoogleAuthProvider, signInWithRedirect, linkWithRedirect, getRedirectResult, signOut } from "firebase/auth";

/* ───────────────────────────────── Mapbox ────────────────────────────────── */

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const ONLINE_TTL_MS = 30 * 60_000;  // 30 minut (můžeš snížit později)

/* ───────────────────────────── Pomocné funkce ───────────────────────────── */

function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// Zmenší obrázek (delší strana max 800 px) → JPEG Blob
async function compressImage(file, maxDim = 800, quality = 0.8) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const { width, height } = img;
  const ratio = Math.min(maxDim / Math.max(width, height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  return blob;
}

/* ─────────────────────────────── Komponenta ─────────────────────────────── */

export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null); // {uid, name, photoURL, soundEnabled}
  const [users, setUsers] = useState({});
  const [pairPings, setPairPings] = useState({}); // pairId -> {uid: time}
  const [chatPairs, setChatPairs] = useState({}); // pairId -> true if chat allowed
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const stored = localStorage.getItem("soundEnabled");
    return stored === null ? true : stored === "1";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [draftName, setDraftName] = useState(
    localStorage.getItem("userName") || ""
  );
  const [fabOpen, setFabOpen] = useState(false);
  const [showChatList, setShowChatList] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [fadeIntro, setFadeIntro] = useState(false);
  const [markerHighlights, setMarkerHighlights] = useState({}); // uid -> color
  const [locationConsent, setLocationConsent] = useState(() =>
    localStorage.getItem("locationConsent") === "1"
  );
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // ref pro nejnovější zvýraznění markerů
  const markerHighlightsRef = useRef({});

  // chat
  const [openChatWith, setOpenChatWith] = useState(null); // uid protistrany
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatPhoto, setChatPhoto] = useState(null); // { file, url }
  const chatUnsub = useRef(null);
  const chatBoxRef = useRef(null);

  // map markers cache
  const markers = useRef({}); // uid -> marker
  const openBubble = useRef(null); // uid otevřené bubliny
  const centeredOnMe = useRef(false);

  // zvuk pomocí Web Audio API
  const audioCtx = useRef(null);
  const lastMsgRef = useRef({}); // pairId -> last message id
  const messagesLoaded = useRef(false);
  const galleryRef = useRef(null);
  const sortableRef = useRef(null);

  useEffect(() => {
    markerHighlightsRef.current = markerHighlights;
  }, [markerHighlights]);

  useEffect(() => {
    audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const unlock = () => {
      if (audioCtx.current.state === "suspended") {
        audioCtx.current.resume();
      }
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  function beep(freq = 880, duration = 0.2) {
    if (!soundEnabled || !audioCtx.current) return;
    const ctx = audioCtx.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function acceptLocation() {
    localStorage.setItem("locationConsent", "1");
    setLocationConsent(true);
    if (navigator.geolocation) {
      if (navigator.geolocation.requestAuthorization) {
        navigator.geolocation.requestAuthorization();
      }
      navigator.geolocation.getCurrentPosition(() => {}, () => {});
    }
  }

  useEffect(() => {
    const unlock = () => {
      pingSound.current.play().catch(() => {});
      pingSound.current.pause();
      msgSound.current.play().catch(() => {});
      msgSound.current.pause();
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    if (localStorage.getItem("soundEnabled") === null) {
      alert("Zvuk je ve výchozím stavu zapnut. Ikonou 🔇/🔊 jej můžeš přepnout.");
      localStorage.setItem("soundEnabled", "1");
    }
  }, []);

  useEffect(() => {
    if (showGallery && galleryRef.current && !sortableRef.current) {
      sortableRef.current = new Sortable(galleryRef.current, {
        animation: 150,
        onEnd: async () => {
          if (!me || !sortableRef.current) return;
          const arr = sortableRef.current.toArray();
          await update(ref(db, `users/${me.uid}`), {
            photos: arr,
            photoURL: arr[0] || null,
            lastActive: Date.now(),
          });
        },
      });
    }
    if (!showGallery && sortableRef.current) {
      sortableRef.current.destroy();
      sortableRef.current = null;
    }
  }, [showGallery, users, me]);

  /* ───────────────────────────── Auth + Me init ─────────────────────────── */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      const name = u.displayName || localStorage.getItem('userName') || 'Anonym';
      const photoURL = u.photoURL || null;
      setMe({ uid: u.uid, name });

      await update(ref(db, `users/${u.uid}`), {
        name,
        photoURL,
        lastActive: Date.now(),
        online: true,
      });

      // Spawn a development bot for the current user when enabled
      if (import.meta.env.VITE_DEV_BOT === '1') spawnDevBot(u.uid);

    });
    return () => unsub();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const result = await getRedirectResult(auth);
        const user = result?.user;
        if (user) {
          await update(ref(db, `users/${user.uid}`), {
            name: user.displayName,
            photoURL: user.photoURL,
          });
        }
      } catch (err) {
        console.error(err);
      }
    })();

    const btnAuth = document.getElementById("btnAuthPrimary");
    const btnSignOut = document.getElementById("btnSignOut");
    if (btnSignOut) {
      btnSignOut.onclick = () => signOut(auth);
    }
    if (!btnAuth) return;
    if (auth.currentUser?.isAnonymous) {
      btnAuth.textContent = "Přihlásit a zachovat data (Google)";
      btnAuth.onclick = async () => {
        const provider = new GoogleAuthProvider();
        await linkWithRedirect(auth.currentUser, provider);
      };
    } else {
      btnAuth.textContent = "Přihlásit (Google)";
      btnAuth.onclick = async () => {
        const provider = new GoogleAuthProvider();
        await signInWithRedirect(auth, provider);
      };
    }
  }, [me]);

  useEffect(() => {
    if (!me || !locationConsent) return;
    if (!("geolocation" in navigator)) return;
    const meRef = ref(db, `users/${me.uid}`);
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };

    const updatePos = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      console.log("Position accuracy", accuracy);
      // Ignore obviously wrong positions with extremely low accuracy (>10 km)
      if (accuracy && accuracy > 10_000) {
        console.warn("Ignoring low-accuracy position", accuracy);
        update(meRef, {
          lastActive: Date.now(),
          online: true,
        });
        return;
      }
      update(meRef, {
        lat: latitude,
        lng: longitude,
        lastActive: Date.now(),
        online: true,
      });
    };
    const handleErr = (err) => {
      console.warn("Geolocation error", err);
      update(meRef, {
        lat: null,
        lng: null,
        lastActive: Date.now(),
        online: false,
      });
    };

    // iOS may not trigger watchPosition immediately; request current position once
    navigator.geolocation.getCurrentPosition(updatePos, handleErr, opts);
    const id = navigator.geolocation.watchPosition(updatePos, handleErr, opts);

    return () => navigator.geolocation.clearWatch(id);
  }, [me, locationConsent]);

  /* ───────────────────────────── Init mapy ──────────────────────────────── */

  useEffect(() => {
    if (map || !me) return;

    let m;
    (async () => {
      // Start at last known position from DB if available, otherwise Prague
      let center = [14.42076, 50.08804];
      try {
        const snap = await get(ref(db, `users/${me.uid}`));
        const u = snap.val();
        if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
          center = [u.lng, u.lat];
        }
      } catch (err) {
        console.warn("Failed to load last position", err);
      }
      m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v12",
        center,
        zoom: 13,
      });
      setMap(m);
    })();

    return () => m && m.remove();
  }, [me]);

  /* ───────────────────── Sledování /users a kreslení ───────────────────── */

  useEffect(() => {
    if (!map || !me) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      // aktualizace / přidání markerů
      Object.entries(data).forEach(([uid, u]) => {
        // u = data daného uživatele, uid = jeho UID
        const viewerUid = (me && me.uid) || null;
        const isDevBot = !!u?.isDevBot;
        const isPrivateBotForSomeoneElse =
          isDevBot && u?.privateTo && u.privateTo !== viewerUid;

        // Když nevíme, kdo je viewer (viewerUid == null), bota NEZOBRAZUJEME.
        if (isPrivateBotForSomeoneElse || (isDevBot && !viewerUid)) {
          if (markers.current[uid]) {
            markers.current[uid].remove();
            delete markers.current[uid];
          }
          return; // nepokračuj ve vykreslování tohoto uživatele
        }

        const isMe = viewerUid && uid === viewerUid;
        // Když je to „já“, marker vždy ponech (i bez lat/lng/online) – jen skipni remove větve:
        const isOnline =
          u.online &&
          u.lastActive &&
          Date.now() - u.lastActive < ONLINE_TTL_MS;
        if (!isMe && (!isOnline || !u.lat || !u.lng)) {
          if (markers.current[uid]) {
            if (openBubble.current === uid) openBubble.current = null;
            markers.current[uid].remove();
            delete markers.current[uid];
          }
          return;
        }

        const highlight = markerHighlightsRef.current[uid];
        const hasPhoto = !!((u.photos && u.photos[0]) || u.photoURL);
        const baseColor = hasPhoto ? (isMe ? "red" : "#147af3") : "black";
        const draggable = false;

        if (!markers.current[uid]) {
          const wrapper = document.createElement("div");
          wrapper.className = "marker-wrapper";
          wrapper.style.transformOrigin = "bottom center";
          const avatar = document.createElement("div");
          avatar.className = "marker-avatar";
          setMarkerAppearance(
            avatar,
            (u.photos && u.photos[0]) || u.photoURL,
            baseColor,
            highlight
          );
          wrapper.appendChild(avatar);

          const bubble = getBubbleContent({
            uid,
            name: u.name || "Anonym",
            photos: u.photos,
            photoURL: u.photoURL,
          });
          wrapper.appendChild(bubble);

          avatar.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleBubble(uid);
          });

          const mk = new mapboxgl.Marker({ element: wrapper, draggable, anchor: "bottom" })
            .setLngLat([u.lng, u.lat])
            .addTo(map);

          markers.current[uid] = mk;
        } else {
          const shouldUpdate = (isOnline || isMe) && u.lat && u.lng;
          if (shouldUpdate) {
            markers.current[uid].setLngLat([u.lng, u.lat]);
          }

          const wrapper = markers.current[uid].getElement();
          const avatar = wrapper.querySelector(".marker-avatar");
          setMarkerAppearance(
            avatar,
            (u.photos && u.photos[0]) || u.photoURL,
            baseColor,
            highlight
          );

          const oldBubble = wrapper.querySelector(".marker-bubble");
          const scrollLeft =
            oldBubble?.querySelector(".bubble-gallery")?.scrollLeft || 0;
          const newBubble = getBubbleContent({
            uid,
            name: u.name || "Anonym",
            photos: u.photos,
            photoURL: u.photoURL,
          });
          wrapper.replaceChild(newBubble, oldBubble);
          const newGallery = newBubble.querySelector(".bubble-gallery");
          if (newGallery) newGallery.scrollLeft = scrollLeft;
          if (wrapper.classList.contains("active")) {
            wireBubbleButtons(uid);
          }
        }
      });

      // odmazat marker, když uživatel zmizel z DB
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid]) {
          if (openBubble.current === uid) openBubble.current = null;
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, me]);

  useEffect(() => {
    if (!map || !me || centeredOnMe.current) return;
    const u = users[me.uid];
    if (
      u &&
      Number.isFinite(u.lat) &&
      Number.isFinite(u.lng)
    ) {
      map.setCenter([u.lng, u.lat]);
      centeredOnMe.current = true;
    }
  }, [map, me, users]);

  useEffect(() => {
    if (!map) return;
    const handler = () => {
      if (openBubble.current) {
        closeBubble(openBubble.current);
        openBubble.current = null;
      }
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [map]);

  // sledování vzájemných pingů
  useEffect(() => {
    if (!me) return;
    const pairRef = ref(db, "pairPings");
    const unsub = onValue(pairRef, (snap) => {
      const data = snap.val() || {};
      setPairPings(data);
      Object.entries(data).forEach(([pid, obj]) => {
        const uids = Object.keys(obj || {});
        if (uids.length >= 2) {
          set(ref(db, `pairs/${pid}`), true);
        }
      });
    });
    return () => unsub();
  }, [me]);

  // sledování povolených chatů – záznamy, které přetrvají i po deploy
  useEffect(() => {
    if (!me) return;
    const pairsRef = ref(db, "pairs");
    const unsub = onValue(pairsRef, (snap) => {
      const data = snap.val() || {};
      const relevant = {};
      Object.keys(data).forEach((pid) => {
        const [a, b] = pid.split("_");
        if (a === me.uid || b === me.uid) relevant[pid] = true;
      });
      setChatPairs(relevant);
    });
    return () => unsub();
  }, [me]);

  // pokud existují zprávy, ulož informaci o chatu pro pozdější použití
  useEffect(() => {
    if (!me) return;
    const msgsRef = ref(db, "messages");
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      Object.keys(data).forEach((pid) => {
        set(ref(db, `pairs/${pid}`), true);
      });
    });
    return () => unsub();
  }, [me]);

  // zvuk při nové zprávě, i když není chat otevřený
  useEffect(() => {
    if (!me) return;
    lastMsgRef.current = {};
    messagesLoaded.current = false;
    const msgsRef = ref(db, "messages");
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      const prev = lastMsgRef.current;
      const next = { ...prev };
      Object.entries(data).forEach(([pid, msgs]) => {
        const [a, b] = pid.split("_");
        if (a !== me.uid && b !== me.uid) return;
        const arr = Object.entries(msgs)
          .sort((a, b) => (a[1].time || 0) - (b[1].time || 0));
        const last = arr[arr.length - 1];
        if (!last) return;
        const [id, m] = last;
        if (
          messagesLoaded.current &&
          prev[pid] !== id &&
          m.from !== me.uid &&
          soundEnabled
        ) {
          beep(660);
          setMarkerHighlights((prev) => ({ ...prev, [m.from]: "purple" }));
        }
        next[pid] = id;
      });
      lastMsgRef.current = next;
      messagesLoaded.current = true;
    });
    return () => unsub();
  }, [me, soundEnabled]);

  // aktualizace bublin při změně pingů nebo uživatelů
  useEffect(() => {
    Object.entries(markers.current).forEach(([uid, mk]) => {
      const u = users[uid];
      if (!u) return;
      const wrapper = mk.getElement();
      const oldBubble = wrapper.querySelector(".marker-bubble");
      const newBubble = getBubbleContent({
        uid,
        name: u.name || "Anonym",
        photos: u.photos,
        photoURL: u.photoURL,
      });
      if (oldBubble) {
        wrapper.replaceChild(newBubble, oldBubble);
      } else {
        wrapper.appendChild(newBubble);
      }
      if (wrapper.classList.contains("active")) {
        wireBubbleButtons(uid);
      }

      const isMe = me && uid === me.uid;
      const isOnline =
        u.online &&
        u.lastActive &&
        Date.now() - u.lastActive < ONLINE_TTL_MS;

      if (!isOnline && !isMe) {
        if (openBubble.current === uid) openBubble.current = null;
        mk.remove();
        delete markers.current[uid];
        return;
      }

      const highlight = markerHighlights[uid];
      const hasPhoto = !!((u.photos && u.photos[0]) || u.photoURL);
      const baseColor = hasPhoto ? (isMe ? "red" : "#147af3") : "black";
      const avatar = wrapper.querySelector(".marker-avatar");
      setMarkerAppearance(
        avatar,
        (u.photos && u.photos[0]) || u.photoURL,
        baseColor,
        highlight
      );
    });
  }, [pairPings, chatPairs, users, me, markerHighlights]);

  function isSafeUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function setMarkerAppearance(el, photoURL, baseColor, highlight) {
    const color = highlight || baseColor;
    if (photoURL && isSafeUrl(photoURL)) {
      el.style.backgroundImage = `url(${photoURL})`;
      el.style.backgroundColor = "";
    } else {
      el.style.backgroundImage = "";
      el.style.backgroundColor = color;
    }
    el.style.boxShadow = highlight
      ? `0 0 0 2px #fff, 0 0 0 4px ${highlight}`
      : "0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,.1)";
    if (highlight) {
      el.classList.add("marker-highlight");
    } else {
      el.classList.remove("marker-highlight");
    }
  }

  function freezeMap(center) {
    if (!map) return;
    if (center) {
      map.setCenter(center);
    }
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
  }

  function unfreezeMap() {
    if (!map) return;
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
  }

  function toggleBubble(uid) {
    if (openBubble.current && openBubble.current !== uid) {
      closeBubble(openBubble.current);
    }
    const mk = markers.current[uid];
    if (!mk) return;
    const el = mk.getElement();
    const active = el.classList.contains("active");
    if (active) {
      el.classList.remove("active");
      openBubble.current = null;
      unfreezeMap();
    } else {
      el.classList.add("active");
      openBubble.current = uid;
      freezeMap(mk.getLngLat());
      wireBubbleButtons(uid);
    }
  }

  function closeBubble(uid) {
    const mk = markers.current[uid];
    if (!mk) return;
    mk.getElement().classList.remove("active");
    unfreezeMap();
  }

  function getBubbleContent({ uid, name, photos, photoURL }) {
    const meVsOther = uid === me.uid;
    const pid = pairIdOf(me.uid, uid);
    const pair = pairPings[pid] || {};
    const canChat = (pair[me.uid] && pair[uid]) || chatPairs[pid];

    const root = document.createElement("div");
    root.className = "marker-bubble";
    root.addEventListener("click", (e) => e.stopPropagation());

    const list = Array.isArray(photos) && photos.length
      ? photos
      : photoURL
      ? [photoURL]
      : [];

    const gallery = document.createElement("div");
    gallery.className = "bubble-gallery";
    ["touchstart", "touchmove", "pointerdown", "pointermove"].forEach((ev) =>
      gallery.addEventListener(ev, (e) => e.stopPropagation())
    );
    if (list.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "bubble-photo empty";
      gallery.appendChild(placeholder);
    } else {
      list.forEach((url) => {
        if (!isSafeUrl(url)) return;
        const img = document.createElement("img");
        img.src = url;
        img.className = "bubble-photo";
        gallery.appendChild(img);
      });
    }
    root.appendChild(gallery);

    const bottom = document.createElement("div");
    bottom.className = "bubble-bottom";

    const nameDiv = document.createElement("div");
    nameDiv.className = "bubble-name";
    nameDiv.textContent = name + (meVsOther ? " (ty)" : "");
    bottom.appendChild(nameDiv);

    if (!meVsOther) {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";

      const actionBtn = document.createElement("button");
      actionBtn.id = `btnAction_${uid}`;
      actionBtn.className = "ping-btn";
      actionBtn.dataset.action = canChat ? "chat" : "ping";
      actionBtn.innerHTML =
        '<span class="ping-btn__text ping-btn__text--ping">'+
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"/></svg>'+
          '<span>Ping</span>'+
        '</span>'+
        '<span class="ping-btn__text ping-btn__text--chat">'+
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16v10H7l-3 3V4Z"/></svg>'+
          '<span>Chat</span>'+
        '</span>';

      const pingText = actionBtn.querySelector(
        ".ping-btn__text--ping"
      );
      const chatText = actionBtn.querySelector(
        ".ping-btn__text--chat"
      );
      if (canChat) {
        chatText.classList.add("visible");
      } else {
        pingText.classList.add("visible");
      }

      actions.appendChild(actionBtn);
      bottom.appendChild(actions);
    }

    root.appendChild(bottom);

    return root;
  }

  function wireBubbleButtons(uid) {
    const mk = markers.current[uid];
    if (!mk) return;
    const el = mk.getElement();
    const btn = el.querySelector(`#btnAction_${uid}`);
    if (btn)
      btn.onclick = (e) => {
        e.stopPropagation();
        if (btn.dataset.action === "chat") {
          openChat(uid);
        } else {
          sendPing(uid);
          btn.dataset.action = "chat";
          btn
            .querySelector(".ping-btn__text--ping")
            ?.classList.remove("visible");
          btn
            .querySelector(".ping-btn__text--chat")
            ?.classList.add("visible");
        }
      };
  }

  /* ─────────────────────────────── Ping / zvuk ──────────────────────────── */

  useEffect(() => {
    if (!me) return;
    const inboxRef = ref(db, `pings/${me.uid}`);
    const unsub = onValue(inboxRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      // každé dítě je ping od někoho
      Object.entries(data).forEach(([fromUid, obj]) => {
        // přehraj zvuk a smaž ping
        if (soundEnabled) {
          beep(880);
        }
        setMarkerHighlights((prev) => ({ ...prev, [fromUid]: "red" }));
        setTimeout(() => {
          setMarkerHighlights((prev) => {
            const copy = { ...prev };
            if (copy[fromUid] === "red") delete copy[fromUid];
            return copy;
          });
        }, 5000);
        remove(ref(db, `pings/${me.uid}/${fromUid}`));
      });
    });
    return () => unsub();
  }, [me, soundEnabled]);

  async function sendPing(toUid) {
    if (!me) return;
    await set(ref(db, `pings/${toUid}/${me.uid}`), {
      time: serverTimestamp(),
    });
    const pid = pairIdOf(me.uid, toUid);
    await set(ref(db, `pairPings/${pid}/${me.uid}`), serverTimestamp());
    const pair = pairPings[pid] || {};
    if (pair[toUid]) {
      await set(ref(db, `pairs/${pid}`), true);
    }
    // také krátké pípnutí odesílateli, aby věděl, že kliknul
    if (soundEnabled) {
      beep(880);
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("soundEnabled", next ? "1" : "0");
    if (next) {
      audioCtx.current?.resume();
    }
  }

  /* ─────────────────────────────── Chat vlákna ──────────────────────────── */

  useEffect(() => {
    if (!me || !openChatWith) {
      setChatMsgs([]);
      return;
    }
    const pid = pairIdOf(me.uid, openChatWith);
    const msgsRef = ref(db, `messages/${pid}`);
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (a.time || 0) - (b.time || 0));
      setChatMsgs(arr);
    });
    chatUnsub.current = unsub;
    return () => {
      chatUnsub.current?.();
      chatUnsub.current = null;
    };
  }, [openChatWith, me, soundEnabled]);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chatMsgs, openChatWith]);

  function openChat(uid) {
    if (!me) return;
    const pid = pairIdOf(me.uid, uid);
    const pair = pairPings[pid] || {};
    if (!((pair[me.uid] && pair[uid]) || chatPairs[pid])) {
      alert("Chat je dostupný až po vzájemném pingnutí.");
      return;
    }
    setOpenChatWith(uid);
    setMarkerHighlights((prev) => {
      const copy = { ...prev };
      delete copy[uid];
      return copy;
    });
  }

  function onPickChatPhoto(e) {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setChatPhoto({ file, url });
    }
    e.target.value = "";
  }

  async function sendMessage() {
    const to = openChatWith;
    if (!me || !to) return;
    const pid = pairIdOf(me.uid, to);
    const msg = {
      from: me.uid,
      to,
      time: Date.now(),
    };
    if (chatText.trim()) msg.text = chatText.trim();
    if (chatPhoto) {
      try {
        const small = await compressImage(chatPhoto.file, 1200, 0.8);
        const dest = sref(storage, `messages/${pid}/${Date.now()}.jpg`);
        await uploadBytes(dest, small, { contentType: "image/jpeg" });
        const url = await getDownloadURL(dest);
        msg.photo = url;
      } catch (e2) {
        console.error(e2);
        alert("Nahrání fotky se nezdařilo.");
      }
    }
    if (!msg.text && !msg.photo) return;
    await push(ref(db, `messages/${pid}`), msg);
    setChatText("");
    if (chatPhoto) {
      URL.revokeObjectURL(chatPhoto.url);
      setChatPhoto(null);
    }
  }

  /* ───────────────────────────── Nastavení / profil ─────────────────────── */

  useEffect(() => {
    if (!me) return;
    const u = users[me.uid];
    if (u && u.name && !draftName) {
      setDraftName(u.name);
      localStorage.setItem("userName", u.name);
    }
  }, [users, me]); // načtení jména z DB při prvním fetchi

  async function saveProfile() {
    if (!me) return;
    const meRef = ref(db, `users/${me.uid}`);
    await update(meRef, {
      name: draftName || "Anonym",
      lastActive: Date.now(),
    });
    localStorage.setItem("userName", draftName || "Anonym");
    setShowSettings(false);
  }

  async function onPickPhotos(e) {
    if (!me) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const existing = users[me.uid]?.photos || [];
      const allowed = Math.max(0, 9 - existing.length);
      const selected = files.slice(0, allowed);
      const urls = [...existing];
      for (let i = 0; i < selected.length; i++) {
        const small = await compressImage(selected[i], 800, 0.8);
        const dest = sref(
          storage,
          `avatars/${me.uid}/${Date.now()}_${i}.jpg`
        );
        await uploadBytes(dest, small, { contentType: "image/jpeg" });
        const url = await getDownloadURL(dest);
        urls.push(url);
      }
      await update(ref(db, `users/${me.uid}`), {
        photos: urls,
        photoURL: urls[0] || null,
        lastActive: Date.now(),
      });
      alert("🖼️ Fotky nahrány.");
    } catch (e2) {
      console.error(e2);
      alert("Nahrání fotek se nezdařilo – zkus menší obrázky.");
    } finally {
      e.target.value = "";
    }
  }

  async function deletePhoto() {
    if (deleteIdx === null || !me) return;
    const arr = [...(users[me.uid]?.photos || [])];
    arr.splice(deleteIdx, 1);
    await update(ref(db, `users/${me.uid}`), {
      photos: arr,
      photoURL: arr[0] || null,
      lastActive: Date.now(),
    });
    setDeleteIdx(null);
  }

  /* ──────────────────────────────── Render UI ───────────────────────────── */

  return (
    <div>
      <div className="auth-bar">
        <button id="btnAuthPrimary"></button>
        <button id="btnSignOut" title="Odhlásit se">Odhlásit</button>
      </div>
      {isIOS && !locationConsent && (
        <div className="consent-modal">
          <div className="consent-modal__content">
            <h2>Souhlas se sdílením polohy</h2>
            <p>Chceme zobrazit tvoji pozici na mapě.</p>
            <button className="btn" onClick={acceptLocation}>
              Souhlasím
            </button>
          </div>
        </div>
      )}
      {/* Plovoucí menu (FAB) */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        {fabOpen && (
          <>
            <button
              onClick={() => {
                setShowSettings(true);
                setFabOpen(false);
              }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
                fontSize: 24,
                lineHeight: "24px",
              }}
              title="Nastavení"
            >
              ⚙️
            </button>
            <button
              onClick={() => {
                setShowGallery(true);
                setFabOpen(false);
              }}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
                fontSize: 24,
                lineHeight: "24px",
              }}
              title="Galerie"
            >
              🖼️
            </button>
            <button
              onClick={() => {
                setShowChatList(true);
                setFabOpen(false);
              }}
              className="fab-chat"
              title="Minulé chaty"
            >
              💬
            </button>
          </>
        )}
        <button
          onClick={() => setFabOpen((o) => !o)}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontSize: 24,
            lineHeight: "24px",
          }}
          title="Menu"
        >
          {fabOpen ? "✖️" : "➕"}
        </button>
      </div>

      {/* Mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {showChatList && (
        <div className="chat-list">
          <div className="chat-list__header">Minulé chaty</div>
          <div className="chat-list__items">
            {Object.keys(chatPairs).length === 0 && (
              <div className="chat-list__empty">Žádné chaty</div>
            )}
            {Object.keys(chatPairs).map((pid) => {
              const [a, b] = pid.split("_");
              const otherUid = a === me.uid ? b : a;
              const u = users[otherUid];
              return (
                <button
                  key={pid}
                  className="chat-list__item"
                  onClick={() => {
                    openChat(otherUid);
                    setShowChatList(false);
                  }}
                >
                  {u?.name || "Neznámý uživatel"}
                </button>
              );
            })}
          </div>
          <button
            className="chat-list__close"
            onClick={() => setShowChatList(false)}
          >
            Zavřít
          </button>
        </div>
      )}

      {/* Chat panel */}
      {openChatWith && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 320,
            maxHeight: 420,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <div
            style={{
              padding: 10,
              borderBottom: "1px solid #eee",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontWeight: 600,
            }}
          >
            {users[openChatWith]?.name || "Chat"}
            <button
              onClick={() => setOpenChatWith(null)}
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
            >
              ✖
            </button>
          </div>
          <div ref={chatBoxRef} className="chat__messages">
            {chatMsgs.map((m) => {
              const mine = m.from === me?.uid;
              return (
                <div key={m.id} className={`msg ${mine ? "msg--me" : "msg--peer"}`}>
                  <div className="msg__time">
                    {new Date(m.time || Date.now()).toLocaleTimeString()}
                  </div>
                  {m.photo && <img src={m.photo} className="msg__image" />}
                  {m.text && <div className="msg__bubble">{m.text}</div>}
                </div>
              );
            })}
          </div>
          <div className="chat__composer" style={{ alignItems: "center" }}>
            {chatPhoto && (
              <img
                src={chatPhoto.url}
                onClick={() => {
                  URL.revokeObjectURL(chatPhoto.url);
                  setChatPhoto(null);
                }}
                style={{
                  width: 40,
                  height: 40,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  cursor: "pointer",
                }}
              />
            )}
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{
                flex: 1,
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
            <input
              id="fileChatPhoto"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onPickChatPhoto}
            />
            <button
              onClick={() => document.getElementById("fileChatPhoto")?.click()}
              style={{
                padding: "8px 10px",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              📷
            </button>
            <button
              onClick={sendMessage}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Galerie (modal) */}
      {showGallery && (
        <div
          onClick={() => setShowGallery(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.15)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 16 }}>
              Galerie
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <input
                id="filePhotos"
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={onPickPhotos}
              />
              <button
                onClick={() => document.getElementById("filePhotos")?.click()}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                📷 Přidat další fotky
              </button>
            </div>

            <div
              ref={galleryRef}
              style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}
            >
              {(users[me.uid]?.photos || []).map((url, idx) => (
                <div key={url} data-id={url} style={{ position: "relative" }}>
                  <img
                    src={url}
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteIdx(idx);
                    }}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      background: "#f33",
                      color: "#fff",
                      border: "none",
                      borderRadius: "50%",
                      width: 18,
                      height: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ✖
                  </button>
                </div>
              ))}
              {(users[me.uid]?.photos || []).length === 0 && (
                <div style={{ fontSize: 13, color: "#666" }}>Žádné fotky</div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowGallery(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                Zavřít
              </button>
            </div>
          </div>
          {deleteIdx !== null && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setDeleteIdx(null);
              }}
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 40,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 260,
                  background: "#fff",
                  borderRadius: 14,
                  padding: 16,
                  boxShadow: "0 10px 30px rgba(0,0,0,.15)",
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  Opravdu chcete smazat fotku?
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={() => setDeleteIdx(null)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Ne
                  </button>
                  <button
                    onClick={deletePhoto}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Ano
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Nastavení (modal) */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.15)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 16 }}>
              Nastavení
            </div>

            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              Jméno
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginTop: 5,
                }}
              />
            </label>

            <div style={{ marginBottom: 10 }}>
              <button
                onClick={toggleSound}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: soundEnabled ? "#e8fff1" : "#fff",
                  cursor: "pointer",
                }}
              >
                {soundEnabled ? "🔊 Zvuk povolen" : "🔈 Povolit zvuk"}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                Zavřít
              </button>
              <button
                onClick={saveProfile}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #147af3",
                  background: "#147af3",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Uložit
              </button>
            </div>
          </div>
        </div>
      )}
      {showIntro && (
        <div
          className={`intro-screen ${fadeIntro ? "intro-screen--hidden" : ""}`}
          onClick={() => {
            setFadeIntro(true);
            setTimeout(() => setShowIntro(false), 500);
          }}
        >
          <img src="/splash.jpg" alt="PutPing" className="intro-screen__img" />
        </div>
      )}
    </div>
  );
}
