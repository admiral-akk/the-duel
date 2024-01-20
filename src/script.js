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
import { io } from "socket.io-client";

/**
 * Helpers
 */
Math.clamp = (num, min, max) => Math.max(min, Math.min(num, max));

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
 * Models
 */

const baseColorTexture = loadTexture("baseColor");
baseColorTexture.flipY = false;
gltfLoader.load("./models/samurai.glb", (data) => {
  const model = data.scene;

  model.mixer = new THREE.AnimationMixer(model);
  model.mixer.clips = data.animations;
  scene.add(model);
  model.traverse(function (child) {
    if (child instanceof THREE.Mesh) {
      child.material = new THREE.MeshBasicMaterial({ map: baseColorTexture });
    }
  });

  const clip = THREE.AnimationClip.findByName(model.mixer.clips, "walk");
  const action = model.mixer.clipAction(clip);
  action.play();
});

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

// STUN server gives you a list of candidates (names) that can be used to reach you.
// It doesn't actually provide networking.
// It just does some network magics to figure out how to appropriately address your client
// from the outside.
/**
 * Networking
 */
const getHostId = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("hostId");
};

const setHostId = (hostId) => {
  const url = new URL(window.location);
  url.searchParams.set("hostId", hostId);
  window.history.pushState(null, "", url.toString());
};

// none ->
//
class WebRTCClient {
  constructor(socketUrl, iceServers) {
    this.state = "FetchingCandidates";
    this.socket = io(socketUrl);
    this.connection = new RTCPeerConnection({
      iceServers: iceServers,
    });
    this.connection.ondatachannel = (event) => {
      console.log("ondatachannel", event);
      this.dataChannel = event.channel;
      this.dataChannel.onopen = (event) => console.log("onopen", event);
      this.dataChannel.onmessage = (event) => {
        console.log("onmessage", event);
        recieveData(event.data);
      };
      this.dataChannel.onclose = (event) => console.log("onclose", event);
    };
    this.dataChannel = this.connection.createDataChannel("data");
    this.dataChannel.onopen = (event) => console.log("onopen", event);
    this.dataChannel.onmessage = (event) => {
      console.log("onmessage", event);
      recieveData(event.data);
    };
    this.dataChannel.onclose = (event) => console.log("onclose", event);

    this.connection.onconnectionstatechange = (event) => {
      console.log("onconnectionstatechange", event);
      if (event.target && event.target.connectionState === "connected") {
        client.playerIndex = server ? 0 : 1;
        this.state = "Connected";
        console.log(this);
        this.socket.disconnect();
      }
    };

    this.connection.oniceconnectionstatechange = (event) =>
      console.log("oniceconnectionstatechange", event);

    this.candidates = [];
    this.offer = null;
    this.otherCandidates = [];
    this.otherOffer = null;

    // the lobby was created
    this.socket.on("lobby", (msg) => {
      console.log("lobby message", msg);
      // we're already in this lobby
      if (msg.hostId === getHostId()) {
        return;
      }
      this.otherCandidates.length = 0;
      this.otherOffer = null;
      setHostId(msg.hostId);
      this.state = "WaitingForAnswer";
    });

    // offer to connect send on connection attempt
    this.socket.on("offer", async (msg) => {
      console.log("offer message", msg);
      this.otherOffer = msg.offer;
      await this.connection.setRemoteDescription(this.otherOffer);
      this.otherCandidates.length = 0;
      msg.candidates.forEach((c) => {
        this.otherCandidates.push(c);
        this.connection.addIceCandidate(c);
      });
      this.candidates.length = 0;
      this.connection.onicecandidate = (event) => {
        console.log("onicecandidate", event);
        if (event.candidate) {
          this.candidates.push(event.candidate);
        } else {
          const answerMsg = {
            hostId: getHostId(),
            offer: this.offer,
            candidates: this.candidates,
          };
          console.log("emit - answer", answerMsg);
          this.socket.emit("answer", answerMsg);
          this.state = "SentAnswer";
        }
      };

      this.offer = await this.connection.createAnswer();
      await this.connection.setLocalDescription(this.offer);
    });

    // if we get an answer back, store the candidates we get.
    this.socket.on("answer", async (msg) => {
      console.log("answer message", msg);
      msg.hostId = getHostId();
      this.otherCandidates.length = 0;
      msg.candidates.forEach((c) => this.otherCandidates.push(c));
      this.otherOffer = msg.offer;
      await this.connection.setRemoteDescription(this.otherOffer);
      this.otherCandidates.forEach(async (c) => {
        this.connection.addIceCandidate(c);
      });
      this.state = "RecievedAnswer";
      server = new GameServer();
    });
  }

  async connect() {
    this.state = "Connecting";
    console.log(this);
    this.connection.onicecandidate = (event) => {
      console.log("onicecandidate", event);
      if (event.candidate) {
        this.candidates.push(event.candidate);
      } else {
        // done fetching candidates
        const joinLobbyMsg = {
          hostId: getHostId(),
          candidates: this.candidates,
          offer: this.offer,
        };
        console.log("emit - joinLobby", joinLobbyMsg);
        this.socket.emit("joinLobby", joinLobbyMsg);
        this.state = "WaitingForOffer";
      }
    };

    this.offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(this.offer);
    console.log(this.offer);
  }
}

const rtcClient = new WebRTCClient("http://localhost:3000/", [
  { urls: "stun:stun.l.google.com:19302" },
]);

function sendData(data) {
  rtcClient.dataChannel.send(JSON.stringify(data));
  console.log("Sent Data: ", data);
}

rtcClient.connect();

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

/**
 * This represents the actual state of the game.
 * Each player sends messages to it and recieves updates from it for their local client.
 * It happens to live on one player's machine, but they shouldn't read from it directly.
 */
class GameServer {
  constructor() {
    this.game = new Game();
  }

  handle(event) {
    switch (event.type) {
      case "selectMove":
        this.game.selectedMoves.set(event.move.playerIndex, event.move);
        this.applyMoves();
        break;
      case "undoMove":
        this.undoMoves();
        break;
      default:
        break;
    }
  }

  sendEventToClients(event) {
    client.handle(event);
    sendData({ target: "client", event: event });
  }

  applyMoves() {
    const changed = this.game.apply();
    if (!changed) {
      return false;
    }

    this.sendEventToClients({
      type: "applyMoves",
      moves: this.game.moveHistory.at(-1),
    });
    return true;
  }

  undoMoves() {
    const changed = this.game.undo();
    if (!changed) {
      return false;
    }
    this.sendEventToClients({
      type: "undoMoves",
    });
    return true;
  }
}

class GameClient {
  constructor(playerIndex) {
    this.playerIndex = playerIndex;
    this.game = new Game();
  }

  sendEventToServer(event) {
    console.log("sendEventToServer", event);
    if (server) {
      console.log("sent to local server");
      server.handle(event);
    } else {
      console.log("sent to remote server");
      sendData({ target: "server", event: event });
    }
  }

  handle(event) {
    switch (event.type) {
      case "applyMoves":
        console.log("applyMoves", event.moves);
        this.game.applyMoves(event.moves);
        break;
      case "undoMoves":
        console.log("undoMoves");
        this.game.undo();
        break;
      default:
        console.log(event);
        throw new Error("Unknown client event");
    }
  }
}
const recieveData = (data) => {
  console.log("recieveData", data);
  const parsedData = JSON.parse(data);
  console.log("parsedData", parsedData);
  switch (parsedData.target) {
    case "server":
      console.log("server event!");
      if (!server) {
        throw new Error("Has no server!");
      }
      server.handle(parsedData.event);
      break;
    case "client":
      console.log("client event!");
      console.log("client data", parsedData.event);
      client.handle(parsedData.event);
      break;
    default:
      break;
  }
};

class Game {
  constructor() {
    this.state = new GameState();
    this.moveHistory = [];
    this.selectedMoves = new Map();
  }

  applyMoves(moves) {
    console.log("apply Moves", moves);
    console.log("state", this);
    moves.forEach((m) => this.selectedMoves.set(m.playerIndex, m));
    this.apply();
  }

  apply() {
    const m0 = this.selectedMoves.get(0);
    const m1 = this.selectedMoves.get(1);
    if (!m0 || !m1) {
      return false;
    }
    const moves = [m0, m1];
    this.selectedMoves.clear();
    this.state.apply(moves);
    this.moveHistory.push(moves);
    return true;
  }

  undo() {
    this.selectedMoves.clear();
    const moves = this.moveHistory.pop();
    if (!moves) {
      return false;
    }
    this.state.undo(moves);
    return true;
  }

  getPlayer(index) {
    return this.state.players[index];
  }
}

// the state at a particular moment in the game
// it does not care how you got here.
class GameState {
  constructor() {
    this.arenaSize = 6;
    const mid = (this.arenaSize - 1) / 2;
    this.players = [
      new Player(Math.floor(mid) - 1),
      new Player(Math.ceil(mid) + 1),
    ];
  }

  apply(moves) {
    // apply every move
    // moves shouldn't change things, just indicate intention
    moves.forEach((m, i) =>
      applyMove(m, this.players[i], this.players[(i + 1) % 2])
    );

    // keep players in bounds
    this.players.forEach((p) => {
      p.nextPosition = p.nextPosition === null ? p.position : p.nextPosition;
      p.nextPosition = Math.clamp(p.nextPosition, 0, this.arenaSize - 1);
    });
    // resolve movement
    if (this.players[0].nextPosition < this.players[1].nextPosition) {
      this.players.forEach((p) => {
        p.position = p.nextPosition;
        p.nextPosition = null;
      });
    }

    // resolve damage
    moves.forEach((m, i) =>
      applyAttack(m, this.players[i], this.players[(i + 1) % 2])
    );

    // resolve damage
    this.players.forEach((p) => {
      p.health -= p.isHit ? 1 : 0;
      p.isHit = false;
    });

    this.players.forEach((p) => console.log(p));
  }

  undo(moves) {
    moves.forEach((m, i) =>
      undoCommand(m, this.players[i], this.players[(i + 1) % 2])
    );
  }
}

class Player {
  constructor(start) {
    this.position = start;
    this.nextPosition = null;
    this.health = 2;
    this.isHit = false;
  }
}

const applyMove = (move, player, opponent) => {
  switch (move.type) {
    case "move":
      player.nextPosition = move.params.nextPosition;
      return;
    default:
      return;
  }
};

const applyAttack = (attack, player, opponent) => {
  switch (attack.type) {
    case "attack":
      const distance = Math.abs(player.position - opponent.position);
      opponent.isHit = distance === attack.params.attackRange;
      return;
    default:
      return;
  }
};

const undoCommand = (command, player, opponent) => {
  switch (command.type) {
    case "move":
      player.position = command.params.position;
      return;
    case "attack":
      opponent.health = command.params.health;
      opponent.isHit = false;
      return;
    default:
      return;
  }
};

class Command {
  constructor(type, playerIndex, params) {
    this.type = type;
    this.playerIndex = playerIndex;
    this.params = params;
  }
}

const getPlayer = (eventCode) => {
  switch (eventCode) {
    case "KeyW":
    case "KeyA":
    case "KeyS":
    case "KeyD":
    case "Space":
      return 0;
    case "ArrowUp":
    case "ArrowLeft":
    case "ArrowDown":
    case "ArrowRight":
    case "Enter":
      return 1;
    default:
      return -2;
  }
};

const offset = (eventCode) => {
  switch (eventCode) {
    case "ArrowUp":
    case "ArrowDown":
    case "KeyW":
    case "KeyS":
      return 0;
    case "ArrowLeft":
    case "KeyA":
      return -1;
    case "ArrowRight":
    case "KeyD":
      return 1;
    default:
      return 0;
  }
};

const keyPressed = (event) => {
  const eventCode = event.code;
  console.log(eventCode);
  const playerIndex = getPlayer(eventCode);
  switch (eventCode) {
    case "Digit1":
      createOffer();
      return;
    case "Digit2":
      acceptRemoteOffer();
      return;
    case "Digit3":
      acceptAnswer();
      return;
    case "Digit4":
      sendData({ type: "test", value: 1 });
      return;
    case "Backspace":
      client.sendEventToServer({ type: "undoMove" });
      return;
    case "KeyS":
    case "KeyW":
    case "KeyA":
    case "KeyD":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      {
        console.log(playerIndex, client.playerIndex);
        if (playerIndex !== client.playerIndex) {
          return;
        }
        const positionOffset = offset(eventCode);
        const position = game.getPlayer(playerIndex).position;

        client.sendEventToServer({
          type: "selectMove",
          move: new Command("move", playerIndex, {
            nextPosition: position + positionOffset,
            position: position,
          }),
        });
      }
      break;
    case "Space":
    case "Enter":
      console.log(playerIndex, client.playerIndex);
      if (playerIndex !== client.playerIndex) {
        return;
      }
      client.sendEventToServer({
        type: "selectMove",
        move: new Command("attack", playerIndex, {
          attackRange: 1,
        }),
      });
      return;
    default:
      return;
  }
};

let server = null;
const client = new GameClient(-1);
const game = client.game;

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
const tiles = Array(game.state.arenaSize)
  .fill(0)
  .map((_, i) => {
    const mesh = tileMesh(textures.get("matcap03"));
    mesh.position.x = i - (game.state.arenaSize - 1) / 2;
    mesh.position.y = -0.4;
    return mesh;
  });

const animateMixer = (elapsedTime, deltaTime) => {
  scene.traverse(function (child) {
    if (child.mixer) {
      child.mixer.update(deltaTime);
    }
  });
};

const animateGame = (elapsedTime, deltaTime) => {
  leftPlayer.position.x =
    game.getPlayer(0).position - (game.state.arenaSize - 1) / 2;
  rightPlayer.position.x =
    game.getPlayer(1).position - (game.state.arenaSize - 1) / 2;
  animateMixer(elapsedTime, deltaTime);
};

/**
 * Animation
 */
const clock = new THREE.Clock();
const tick = () => {
  stats.begin();

  timeTracker.timeSpeed = document.hasFocus() ? debugObject.timeSpeed : 0;
  timeTracker.deltaTime = timeTracker.timeSpeed * clock.getDelta();
  timeTracker.elapsedTime += timeTracker.deltaTime;

  // update controls
  controls.update();
  game.apply();

  // Render scene
  animateGame(timeTracker.elapsedTime, timeTracker.deltaTime);
  composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};

initLoadingAnimation();
tick();
