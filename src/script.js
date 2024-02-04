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
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
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

THREE.Cache.enabled = true;
const loadingManager = new THREE.LoadingManager();
loadingManager.hasFiles = false;
loadingManager.onStart = () => (loadingManager.hasFiles = true);
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
const models = new Map();

const loadModel = (name, texture) => {
  gltfLoader.load(`./models/${name}.glb`, (data) => {
    const model = data.scene;
    model.traverse(function (child) {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshBasicMaterial({ map: texture });
      }
    });
    model.animations = data.animations;
    models.set(name, model);
  });
};

const getModel = (name) => {
  if (!models.has(name)) {
    return null;
  }
  const rawModel = models.get(name);

  const model = SkeletonUtils.clone(rawModel);
  scene.add(model);

  model.mixer = new THREE.AnimationMixer(model);
  model.mixer.clips = rawModel.animations;
  model.mixer.playAnimation = (name, loopMode = THREE.LoopOnce) => {
    model.mixer.stopAllAction();
    const action = model.mixer.clipAction(name);
    action.setLoop(loopMode);
    action.play();
  };
  model.mixer.playAnimation("walk.low");
  model.mixer.addEventListener("finished", (e) => {
    switch (e.action._clip.name) {
      case "walk.low":
      case "walk.high":
        e.action.reset();
        e.action.play();
        break;
      case "slash.low":
        model.mixer.playAnimation("walk.high");
        break;
      case "slash.high":
        model.mixer.playAnimation("walk.low");
        break;
    }
  });
  return model;
};

loadModel("samurai", baseColorTexture);

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
camera.position.y = 1.5;
camera.position.z = 2.5;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;

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
    gameGraphics.spawnMeshes();
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
  loadingManager.onProgress = (_, itemsLoaded, itemsTotal) => {
    updateProgress(itemsLoaded / itemsTotal);
  };
  if (!loadingManager.hasFiles) {
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

/**
 * Params
 */

/**
 * Loaded Objects
 */
loadTexture("matcap01");
loadTexture("matcap02");
loadTexture("matcap03");
loadSound("swoosh01");
loadFont("helvetiker_regular.typeface");

/**
 *
 */
// This class controls the whole game, transitioning you from between games.
class GameManager {
  // states:
  // Start - just opened the page
  // JoinLobby - try to join a lobby
  // WaitingInLobby - have a lobbyId, waiting for someone to join
  // Connected - connected to another player, ready to start game
  // InGame - in the game
  // GameOver - game ended
  //
  // valid transitions:
  // Start -> JoinLobby
  // Start -> WaitingInLobby
  // JoinLobby -> WaitingInLobby
  // JoinLobby -> Connected
  // Connected -> InGame
  // InGame -> GameOver
  // GameOver -> InGame
  // GameOver -> WaitingInLobby
  constructor() {
    this.state = "Start";
    const localMode = urlParams.get("localMode");
    if (!localMode) {
      this.rtcClient = new WebRTCClient("ws://44.202.30.187:3000", [
        { urls: "stun:stun.l.google.com:19302" },
      ]);
    }
  }
}

let rtcClient = null;
function sendData(data) {
  if (rtcClient) {
    rtcClient.dataChannel.send(JSON.stringify(data));
    console.log("Sent Data: ", data);
  } else {
    console.log("No client to send data: ", data);
  }
}

const urlParams = new URLSearchParams(window.location.search);
const localMode = true; //urlParams.get("localMode");
if (!localMode) {
  rtcClient = new WebRTCClient("ws://44.202.30.187:3000", [
    { urls: "stun:stun.l.google.com:19302" },
  ]);
  rtcClient.connect();
}

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

  sendEventToClients(event) {
    console.log("client event", event);
    clients.forEach((c) => c.handle(event));
    if (rtcClient) {
      sendData({ target: "client", event: event });
    }
  }

  handle(event) {
    switch (event.type) {
      case "selectMove":
        this.game.applyMoves(event.move[0], event.move[1]);

        this.sendEventToClients({
          type: "applyMoves",
          move: event.move,
        });
        break;
      case "undoMove":
        const changed = this.game.undo();
        if (!changed) {
          return false;
        }
        this.sendEventToClients({
          type: "undoMoves",
        });
        break;
      default:
        break;
    }
  }
}

class GameClient {
  constructor(playerIndex) {
    this.playerIndex = playerIndex;
    this.game = new Game();
    this.selectedMoves = [null, null];
    this.changed = false;
  }

  activePlayer() {
    return this.game.activePlayer();
  }

  submitMoves() {
    if (this.selectedMoves.some((v) => v === null)) {
      return false;
    }
    // submit moves
    this.sendEventToServer({
      type: "selectMove",
      move: this.selectedMoves,
    });
    this.selectedMoves = [null, null];
  }

  selectMove(move) {
    console.log(this.selectedMoves);
    if (move === "Submit") {
      this.submitMoves();
      return;
    }

    // check if it's our turn to move
    if (this.playerIndex !== this.activePlayer()) {
      return;
    }

    // check if we've already selected this move.
    const moveIndex = this.selectedMoves.findIndex(
      (v) => v !== null && v.move === move
    );

    const firstEmptyIndex = this.selectedMoves.findIndex((v) => v === null);
    if (moveIndex >= 0) {
      this.selectedMoves[moveIndex] = null;
    }
    // check if they've already selected 2 moves
    else if (firstEmptyIndex >= 0) {
      this.selectedMoves[firstEmptyIndex] = {
        playerIndex: this.playerIndex,
        move: move,
      };
    }
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
        console.log("applyMoves", event.move);
        this.game.applyMoves(event.move[0], event.move[1]);
        break;
      case "undoMoves":
        console.log("undoMoves");
        this.game.undo();
        break;
      default:
        console.log(event);
        throw new Error("Unknown client event");
    }
    this.changed = true;
  }

  hasUpdated() {
    if (this.changed) {
      this.changed = false;
      return true;
    }
    return false;
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

// A command is the user's intention (ex: move forward)
// A delta is the state was before and after (ex: there was a wall in front, no change in position)
class Game {
  constructor() {
    this.state = new GameState();
    this.history = [];
    this.nextCommands = [null, new Command(1, "Advance")];
    this.priorityPlayer = 0;
  }

  applyMoves(first, second) {
    const activePlayer = this.activePlayer();
    this.nextCommands[activePlayer] = first;
    const deltas = this.state.apply(this.nextCommands);
    this.history.push([this.nextCommands, deltas]);
    this.nextCommands = [null, null];
    this.nextCommands[activePlayer] = second;
    console.log("next commands after apply", this.nextCommands);
    return true;
  }

  activePlayer() {
    return this.nextCommands.findIndex((m) => m === null);
  }

  lastCommand(playerIndex) {
    if (this.history.length) {
      return this.history[this.history.length - 1][0][playerIndex];
    } else {
      return { playerIndex: playerIndex, move: "Advance" };
    }
  }

  undo() {
    if (!this.history.length) {
      return;
    }
    const activePlayer = this.activePlayer();
    const [moves, deltas] = this.history.pop();
    this.state.undo(deltas);
    this.nextCommands = moves;
    this.nextCommands[(activePlayer + 1) % 2] = null;
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
    this.arenaSize = 8;
    const mid = (this.arenaSize - 1) / 2;
    this.players = [
      new Player(Math.floor(mid) - 2),
      new Player(Math.ceil(mid) + 2),
    ];
  }

  applyMove({ playerIndex, move }) {
    let offset = Math.sign(0.5 - playerIndex);
    const player = this.players[playerIndex];
    console.log("players", this.players);
    console.log("player", playerIndex, player);
    player.nextPosition = player.position;
    switch (move) {
      case "Charge":
        offset *= 2;
        break;
      case "Retreat":
        offset *= -1;
        break;
      case "Advance":
        break;
      default:
        return;
    }
    player.nextPosition += offset;
  }

  applyAttack({ playerIndex, move }) {
    const player = this.players[playerIndex];
    const opponent = this.players[(playerIndex + 1) % 2];
    switch (move) {
      case "SwitchAttack":
        const distance = Math.abs(player.position - opponent.position);
        const attackRange = player.stance === "high" ? 2 : 1;

        opponent.isHit = distance === attackRange;
        player.stance = player.stance === "high" ? "low" : "high";
        return;
      default:
        return;
    }
  }

  getPlayerStates() {
    return Array.from(
      this.players.map((p) => {
        return {
          health: p.health,
          position: p.position,
          stance: p.stance,
        };
      })
    );
  }

  setPlayerStates(states) {
    states.forEach((s, i) => {
      const player = this.players[i];
      player.health = s.health;
      player.position = s.position;
      player.stance = s.stance;
      player.nextPosition = s.position;
      player.isHit = false;
    });
  }

  apply(moves) {
    // store state before
    const deltas = {
      before: this.getPlayerStates(),
    };

    // apply every move
    // moves shouldn't change things, just indicate intention
    moves.forEach((m, i) =>
      this.applyMove(m, this.players[i], this.players[(i + 1) % 2])
    );

    // keep players in bounds
    this.players.forEach((p) => {
      p.nextPosition = Math.clamp(
        p.nextPosition ?? p.position,
        0,
        this.arenaSize - 1
      );
    });

    // resolve movement
    if (this.players[0].nextPosition < this.players[1].nextPosition) {
      this.players.forEach((p) => {
        p.position = p.nextPosition;
        p.nextPosition = null;
      });
    }

    // see who's hit
    moves.forEach((m, i) =>
      this.applyAttack(m, this.players[i], this.players[(i + 1) % 2])
    );

    // resolve damage
    this.players.forEach((p) => {
      p.health -= p.isHit ? 1 : 0;
      p.isHit = false;
    });

    this.players.forEach((p) => console.log(p));

    deltas.after = this.getPlayerStates();
    return deltas;
  }

  undo(deltas) {
    this.setPlayerStates(deltas.before);
  }
}

class Player {
  constructor(start) {
    this.stance = "high";
    this.position = start;
    this.nextPosition = null;
    this.health = 2;
    this.isHit = false;
  }
}

class Command {
  constructor(playerIndex, move) {
    this.playerIndex = playerIndex;
    this.move = move;
  }
}

const keyPressed = (event) => {
  switch (event.code) {
    case "Backspace":
      clients[0].sendEventToServer({ type: "undoMove" });
      return;
    default:
      return;
  }
};

let server = new GameServer();
const clients = [new GameClient(0), new GameClient(1)];
const game = clients[0].game;

/**
 * Game Graphics
 */

const tileMesh = (matcapTexture) => {
  const geo = new THREE.BoxGeometry(0.2, 0.1, 0.5);
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

class GameGraphics {
  constructor(game) {
    this.game = game;
    this.players = [];
    this.tiles = [];
  }

  spawnMeshes() {
    this.players.push(getModel("samurai"));
    this.players.push(getModel("samurai"));
    console.log("players", this.players);

    this.tiles = Array(game.state.arenaSize)
      .fill(0)
      .map((_, i) => {
        const mesh = tileMesh(textures.get("matcap03"));
        mesh.position.x = 0.7 * (i - (game.state.arenaSize - 1) / 2);
        mesh.position.y = -0.4;
        return mesh;
      });
  }

  animateGame = (elapsedTime, deltaTime, moved) => {
    let gameEnded = false;
    this.players.forEach((mesh, i) => {
      const player = game.getPlayer(i);
      if (player.health === 0) {
        gameEnded = true;
      }
      mesh.position.x =
        0.7 * (player.position - (game.state.arenaSize - 1) / 2);
      mesh.lookAt(new THREE.Vector3(-100 * (i - 0.5), 0, 0));
      if (moved) {
        console.log("move history", game.history);
        const { move } = game.lastCommand(i);
        switch (move) {
          case "SwitchAttack":
            if (player.stance === "high") {
              mesh.mixer.playAnimation("slash.low");
            } else {
              mesh.mixer.playAnimation("slash.high");
            }
            break;
          default:
            if (player.stance === "high") {
              mesh.mixer.playAnimation("walk.high");
            } else {
              mesh.mixer.playAnimation("walk.low");
            }
        }
      }
    });
    scene.traverse(function (child) {
      if (child.mixer) {
        child.mixer.update(deltaTime);
      }
    });
    if (!hasEnded && gameEnded) {
      hasEnded = true;
      const greyed = document.createElement("div");
      greyed.setAttribute("class", "greyed");
      overlay.appendChild(greyed);
      const menu = document.createElement("div");
      menu.setAttribute("class", "menu");
      greyed.appendChild(menu);
      const textMenu = document.createElement("div");
      textMenu.setAttribute("class", "textMenu");
      textMenu.innerHTML = "GAME OVER";
      menu.appendChild(textMenu);
      const buttonHolder = document.createElement("div");
      buttonHolder.setAttribute("class", "buttonHolder");
      menu.appendChild(buttonHolder);
      const reset = document.createElement("button");
      reset.setAttribute("class", "reset");
      reset.textContent = "Reset";
      buttonHolder.appendChild(reset);
    }
  };
}

const gameGraphics = new GameGraphics(game);

/**
 *
 */

const actionMenu = (parent) => {
  const menu = document.createElement("div");
  menu.setAttribute("class", "actionMenu");
  parent.appendChild(menu);
  return menu;
};

const makeActiveTracker = (parent, playerIndex) => {
  const d = document.createElement("div");
  d.setAttribute("class", "health");

  const active = clients[playerIndex].activePlayer();
  d.innerHTML = active === playerIndex ? "Active" : "Waiting";
  parent.appendChild(d);
  return d;
};
const makeHealthTracker = (parent, playerIndex) => {
  const d = document.createElement("div");
  d.setAttribute("class", "health");
  d.innerHTML = "Health: 2";
  parent.appendChild(d);
  return d;
};
const makeActionButton = (parent, playerIndex, text, move) => {
  const b = document.createElement("button");
  b.setAttribute("class", "actionButton");
  b.textContent = text;
  b.onclick = () => {
    clients[playerIndex].selectMove(move);
  };
  parent.appendChild(b);
  const c = document.createElement("div");
  c.classList.add("counter", "counter-none");
  c.textContent = "";
  b.appendChild(c);

  return { button: b, counter: c };
};

const makeOverlay = (parent) => {
  const menu = document.createElement("div");
  menu.setAttribute("class", "overlay");
  parent.appendChild(menu);
};
let hasEnded = false;
class GameUI {
  update(gameClients, game) {
    this.activeTrackers.forEach(
      (a, i) => (a.innerHTML = i === game.activePlayer() ? "Active" : "Waiting")
    );
    this.healthTrackers.forEach(
      (h, i) => (h.innerHTML = `Health: ${game.getPlayer(i).health}`)
    );
    this.game.state.players.forEach((_, i) => {
      this.actions[i].forEach((v, k) => {
        const counter = v.counter;
        const classList = v.counter.classList;
        classList.remove("counter-none", "counter-1", "counter-2");
        const moveIndex = gameClients[i].selectedMoves.findIndex(
          (m) => m !== null && m.move === k
        );
        if (i !== game.activePlayer() || moveIndex < 0) {
          counter.textContent = "";
          classList.add("counter-none");
        } else if (moveIndex === 0) {
          counter.textContent = "1";
          classList.add("counter-1");
        } else if (moveIndex === 1) {
          counter.textContent = "2";
          classList.add("counter-2");
        }
      });
    });
  }
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.overlay = makeOverlay(root);
    this.activeTrackers = [];
    this.healthTrackers = [];
    this.actions = [];
    this.game.state.players.forEach((_, i) => {
      const menu = actionMenu(root);
      this.activeTrackers.push(makeActiveTracker(menu, i));
      this.healthTrackers.push(makeHealthTracker(menu, i));
      this.actions.push(new Map());
      this.actions[i].set(
        "SwitchAttack",
        makeActionButton(menu, i, "Switch Attack", "SwitchAttack")
      );
      this.actions[i].set(
        "Retreat",
        makeActionButton(menu, i, "Retreat", "Retreat")
      );
      this.actions[i].set(
        "Advance",
        makeActionButton(menu, i, "Advance", "Advance")
      );
      this.actions[i].set(
        "Charge",
        makeActionButton(menu, i, "Charge", "Charge")
      );
      this.actions[i].set(
        "Submit",
        makeActionButton(menu, i, "Submit", "Submit")
      );
    });
  }
}

const gameUI = new GameUI(game, ui);

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
  const moved = clients[0].hasUpdated();
  gameUI.update(clients, clients[0].game);

  // Render scene
  gameGraphics.animateGame(
    timeTracker.elapsedTime,
    timeTracker.deltaTime,
    moved
  );
  composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};
initLoadingAnimation();
tick();
