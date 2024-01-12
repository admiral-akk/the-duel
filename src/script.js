import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import "webrtc-adapter";
import GUI from "lil-gui";
import { gsap } from "gsap";
import Stats from "stats-js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import loadingVertexShader from "./shaders/loading/vertex.glsl";
import loadingFragmentShader from "./shaders/loading/fragment.glsl";
import matcapVertexShader from "./shaders/matcap/vertex.glsl";
import matcapFragmentShader from "./shaders/matcap/fragment.glsl";

/**
 * Core objects
 */
const container = document.querySelector("div.container");
const canvasContainer = document.querySelector("div.relative");
const ui = document.querySelector("div.ui");
const canvas = document.querySelector("canvas.webgl");
const aspectRatio = 16 / 9;
const camera = new THREE.PerspectiveCamera(75, aspectRatio);
const renderer = new THREE.WebGLRenderer({ canvas });
const listener = new THREE.AudioListener();
camera.add(listener);
renderer.setClearColor("#201919");
const scene = new THREE.Scene();
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
var stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/**
 * Loader Setup
 */

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
const audioLoader = new THREE.AudioLoader(loadingManager);
const gltfLoader = new GLTFLoader(loadingManager);
const fontLoader = new FontLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
dracoLoader.setDecoderPath("./draco/gltf/");

/**
 * Textures
 */
const textures = new Map();

const loadTextureFromUrl = (url) => {
  const texture = textureLoader.load(url);
  textures.set(url, texture);
  return texture;
};

const loadTexture = (name) => {
  const texture = textureLoader.load(`./texture/${name}.png`);
  textures.set(name, texture);
  return texture;
};

/**
 * Fonts
 */
const fonts = new Map();

const loadFont = (name) => {
  fontLoader.load(`./fonts/${name}.json`, function (font) {
    fonts.set(name, font);
  });
};

/**
 * Audio
 */
const audioPool = [];
const buffers = new Map();

const loadSound = (name) => {
  audioLoader.load(`./audio/${name}.mp3`, function (buffer) {
    buffers.set(name, buffer);
  });
};

const playSound = (name) => {
  if (!buffers.has(name)) {
    return;
  }
  const buffer = buffers.get(name);
  let audio = audioPool.filter((a) => !a.isPlaying).pop();
  if (!audio) {
    audio = new THREE.Audio(listener);
  }
  audio.setBuffer(buffer);
  audio.play();
};

/**
 * Window size
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
  verticalOffset: 0,
  horizontalOffset: 0,
};
const updateSize = () => {
  if (window.innerHeight * camera.aspect > window.innerWidth) {
    sizes.width = window.innerWidth;
    sizes.height = window.innerWidth / camera.aspect;
    sizes.verticalOffset = (window.innerHeight - sizes.height) / 2;
    sizes.horizontalOffset = 0;
  } else {
    sizes.width = window.innerHeight * camera.aspect;
    sizes.height = window.innerHeight;
    sizes.verticalOffset = 0;
    sizes.horizontalOffset = (window.innerWidth - sizes.width) / 2;
  }
  canvasContainer.style.top = sizes.verticalOffset.toString() + "px";
  canvasContainer.style.left = sizes.horizontalOffset.toString() + "px";

  renderer.setSize(sizes.width, sizes.height);
  composer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
};
updateSize();

/**
 * Mouse tracking
 */

const mousePos = (event) => {
  return new THREE.Vector2(
    ((event.clientX - sizes.horizontalOffset) / sizes.width) * 2 - 1,
    -((event.clientY - sizes.verticalOffset) / sizes.height) * 2 + 1
  );
};

/**
 * Event Handling
 */
const eventLog = [];
const loggedEvents = new Set(["pointerdown", "pointerup", "keyup"]);
const universalEventHandler = (event) => {
  if (loggedEvents.has(event.type)) {
    eventLog.push([timeTracker.elapsedTime, event]);
  }
  switch (event.type) {
    case "resize":
    case "orientationchange":
      updateSize();
      break;
    case "dblclick":
      if (event.target.className !== "webgl") {
        return;
      }
      const fullscreenElement =
        document.fullscreenElement || document.webkitFullscreenElement;

      if (fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
      break;
    case "pointerdown":
    case "pointerup":
    case "pointermove":
      if (event.target.className !== "webgl") {
        return;
      }
      const pos = mousePos(event);
      break;
    case "keyup":
      keyPressed(event);
      break;
    default:
      break;
  }
};

const events = new Set();
for (const key in canvas) {
  if (/^on/.test(key)) {
    const eventType = key.substring(2);
    events.add(eventType);
    window.addEventListener(eventType, universalEventHandler);
  }
}

/**
 * Setup camera
 */
camera.position.y = 1;
camera.position.z = 1.5;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = true;

/**
 * Debug
 */

const debugObject = { timeSpeed: 1.0 };
const gui = new GUI();
gui
  .add(debugObject, "timeSpeed")
  .min(0)
  .max(3)
  .step(0.1)
  .onChange((v) => {
    timeTracker.timeSpeed = v;
  });

/**
 * Loading overlay
 */
const loadingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMinY: { value: 0.0 },
    uWidthY: { value: 0.005 },
    uMaxX: { value: 0.0 },
  },
  vertexShader: loadingVertexShader,
  fragmentShader: loadingFragmentShader,
};

const loadingScreen = new ShaderPass(loadingShader);
const loadingUniforms = loadingScreen.material.uniforms;
composer.addPass(loadingScreen);

/**
 * Loading Animation
 */
let progressRatio = 0.0;
let currAnimation = null;
let timeTracker = { timeSpeed: 0, deltaTime: 0, elapsedTime: 0.0 };
const updateProgress = (progress) => {
  progressRatio = Math.max(progress, progressRatio);
  if (currAnimation) {
    currAnimation.kill();
  }
  currAnimation = gsap.to(loadingUniforms.uMaxX, {
    duration: 1,
    value: progressRatio,
  });
  if (progressRatio == 1) {
    currAnimation.kill();
    const timeline = gsap.timeline();
    currAnimation = timeline.to(loadingUniforms.uMaxX, {
      duration: 0.2,
      value: progressRatio,
    });
    timeline.set(timeTracker, { timeSpeed: debugObject.timeSpeed });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      delay: 0.0,
      value: 0.01,
      ease: "power1.inOut",
    });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      value: 0.0,
      ease: "power1.in",
    });
    timeline.to(loadingUniforms.uMinY, {
      duration: 0.5,
      value: 0.5,
      ease: "power1.in",
    });
  }
};

const initLoadingAnimation = () => {
  if (loadingManager.itemsTotal > 0) {
    loadingManager.onProgress = (_, itemsLoaded, itemsTotal) =>
      updateProgress(itemsLoaded / itemsTotal);
  } else {
    updateProgress(1);
  }
};

/**
 * Networking
 *
 * Logic largely replicated from: https://webrtc.github.io/samples/
 */
let pc;
let sendChannel;
let receiveChannel;

const signaling = new BroadcastChannel("webrtc");
signaling.onmessage = (e) => {
  switch (e.data.type) {
    case "offer":
      handleOffer(e.data);
      break;
    case "answer":
      handleAnswer(e.data);
      break;
    case "candidate":
      handleCandidate(e.data);
      break;
    case "ready":
      // A second tab joined. This tab will enable the start button unless in a call already.
      if (pc) {
        console.log("already in call, ignoring");
        return;
      }
      break;
    case "bye":
      if (pc) {
        hangup();
      }
      break;
    default:
      console.log("unhandled", e);
      break;
  }
};

const connect = async () => {
  await createPeerConnection();
  sendChannel = pc.createDataChannel("sendDataChannel");
  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onmessage = onSendChannelMessageCallback;
  sendChannel.onclose = onSendChannelStateChange;

  const offer = await pc.createOffer();
  signaling.postMessage({ type: "offer", sdp: offer.sdp });
  await pc.setLocalDescription(offer);
};

const close = async () => {
  hangup();
  signaling.postMessage({ type: "bye" });
};

async function hangup() {
  if (pc) {
    pc.close();
    pc = null;
  }
  sendChannel = null;
  receiveChannel = null;
  console.log("Closed peer connections");
}

function createPeerConnection() {
  pc = new RTCPeerConnection();
  pc.onicecandidate = (e) => {
    const message = {
      type: "candidate",
      candidate: null,
    };
    if (e.candidate) {
      message.candidate = e.candidate.candidate;
      message.sdpMid = e.candidate.sdpMid;
      message.sdpMLineIndex = e.candidate.sdpMLineIndex;
    }
    signaling.postMessage(message);
  };
}

async function handleOffer(offer) {
  if (pc) {
    console.error("existing peerconnection");
    return;
  }
  await createPeerConnection();
  pc.ondatachannel = receiveChannelCallback;
  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  signaling.postMessage({ type: "answer", sdp: answer.sdp });
  await pc.setLocalDescription(answer);
}

async function handleAnswer(answer) {
  if (!pc) {
    console.error("no peerconnection");
    return;
  }
  await pc.setRemoteDescription(answer);
}

async function handleCandidate(candidate) {
  if (!pc) {
    console.error("no peerconnection");
    return;
  }
  if (!candidate.candidate) {
    await pc.addIceCandidate(null);
  } else {
    await pc.addIceCandidate(candidate);
  }
}

let iter = 1;

function sendData() {
  iter++;
  if (sendChannel) {
    sendChannel.send(iter);
  } else {
    receiveChannel.send(iter);
  }
  console.log("Sent Data: " + iter);
}

function receiveChannelCallback(event) {
  console.log("Receive Channel Callback");
  receiveChannel = event.channel;
  receiveChannel.onmessage = onReceiveChannelMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;
}

function onReceiveChannelMessageCallback(event) {
  console.log("Received Message", event.data);
}

function onSendChannelMessageCallback(event) {
  console.log("Received Message", event.data);
}

function onSendChannelStateChange() {
  const readyState = sendChannel.readyState;
  console.log("Send channel state is: " + readyState);
}

function onReceiveChannelStateChange() {
  const readyState = receiveChannel.readyState;
  console.log(`Receive channel state is: ${readyState}`);
}

/**
 * Loaded Objects
 */
loadTexture("matcap01");
loadTexture("matcap02");
loadTexture("matcap03");
loadSound("swoosh01");
loadFont("helvetiker_regular.typeface");

/**
 * Game Rules
 */

class Player {
  constructor(start) {
    this.position = start;
    this.targetPos = null;
    this.health = 2;
  }
}

class Command {
  constructor(apply, undo) {
    this.apply = apply;
    this.undo = undo;
  }
}

const gameState = {
  leftPlayer: new Player(1),
  rightPlayer: new Player(3),
  arena: [0, 0, 0, 0, 0],
  leftCurrentCommand: null,
  rightCurrentCommand: null,
  leftCommands: [],
  rightCommands: [],
};

const keyPressed = (event) => {
  console.log(event.code);
  switch (event.code) {
    case "Backspace":
      if (!gameState.leftCommands.length) {
        return;
      }
      if (!gameState.rightCommands.length) {
        return;
      }
      gameState.leftCommands.pop().undo();
      gameState.rightCommands.pop().undo();
      return;
    case "KeyA":
      {
        const position = gameState.leftPlayer.position;
        const targetPos = gameState.leftPlayer.position - 1;
        gameState.leftCurrentCommand = new Command(
          () => {
            gameState.leftPlayer.targetPos = Math.max(0, targetPos);
          },
          () => {
            gameState.leftPlayer.position = position;
          }
        );
      }
      break;
    case "KeyD":
      {
        const position = gameState.leftPlayer.position;
        const targetPos = gameState.leftPlayer.position + 1;
        gameState.leftCurrentCommand = new Command(
          () => {
            gameState.leftPlayer.targetPos = targetPos;
          },
          () => {
            gameState.leftPlayer.position = position;
          }
        );
      }
      break;
    case "Space":
      // left player
      return;

    case "ArrowLeft":
      {
        const position = gameState.rightPlayer.position;
        const targetPos = gameState.rightPlayer.position - 1;
        gameState.rightCurrentCommand = new Command(
          () => {
            gameState.rightPlayer.targetPos = targetPos;
          },
          () => {
            gameState.rightPlayer.position = position;
          }
        );
      }
      break;
    case "ArrowRight":
      {
        const position = gameState.rightPlayer.position;
        const targetPos = gameState.rightPlayer.position + 1;
        gameState.rightCurrentCommand = new Command(
          () => {
            gameState.rightPlayer.targetPos = Math.min(
              targetPos,
              gameState.arena.length - 1
            );
          },
          () => {
            gameState.rightPlayer.position = position;
          }
        );
      }

      break;
    case "Enter":
      // right player
      return;
    default:
      return;
  }
};

const updateGame = () => {
  if (!gameState.leftCurrentCommand) {
    return;
  }
  if (!gameState.rightCurrentCommand) {
    return;
  }
  gameState.leftCurrentCommand.apply();
  gameState.rightCurrentCommand.apply();

  // non-intersecting moves
  if (gameState.leftPlayer.targetPos < gameState.rightPlayer.targetPos) {
    gameState.leftPlayer.position = gameState.leftPlayer.targetPos;
    gameState.rightPlayer.position = gameState.rightPlayer.targetPos;
  }
  gameState.leftPlayer.targetPos = null;
  gameState.rightPlayer.targetPos = null;
  gameState.leftCommands.push(gameState.leftCurrentCommand);
  gameState.rightCommands.push(gameState.rightCurrentCommand);
  gameState.leftCurrentCommand = null;
  gameState.rightCurrentCommand = null;
};

/**
 * Game Graphics
 */

const playerMesh = (matcapTexture) => {
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: matcapVertexShader,
    fragmentShader: matcapFragmentShader,
    uniforms: {
      uMatcap: {
        type: "sampler2D",
        value: matcapTexture,
      },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 4;
  scene.add(mesh);
  return mesh;
};

const tileMesh = (matcapTexture) => {
  const geo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: matcapVertexShader,
    fragmentShader: matcapFragmentShader,
    uniforms: {
      uMatcap: {
        type: "sampler2D",
        value: matcapTexture,
      },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return mesh;
};

const leftPlayer = playerMesh(textures.get("matcap01"));
const rightPlayer = playerMesh(textures.get("matcap02"));
const tiles = gameState.arena.map((v, i) => {
  const mesh = tileMesh(textures.get("matcap03"));
  mesh.position.x = i - (gameState.arena.length - 1) / 2;
  mesh.position.y = -0.4;
  return mesh;
});

const animateGame = (elapsedTime, deltaTime) => {
  leftPlayer.position.x =
    gameState.leftPlayer.position - (gameState.arena.length - 1) / 2;
  rightPlayer.position.x =
    gameState.rightPlayer.position - (gameState.arena.length - 1) / 2;
};

/**
 * Animation
 */
const clock = new THREE.Clock();
const tick = () => {
  stats.begin();

  timeTracker.timeSpeed = document.hasFocus() ? debugObject.timeSpeed : 0;
  timeTracker.deltaTime = clock.getDelta();
  timeTracker.elapsedTime += timeTracker.timeSpeed * timeTracker.deltaTime;

  // update controls
  controls.update();
  updateGame();

  // Render scene
  animateGame();
  composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};

initLoadingAnimation();
tick();
