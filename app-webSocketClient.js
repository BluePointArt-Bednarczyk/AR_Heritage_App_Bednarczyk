import * as THREE from "three";
import { XRButton } from "three/addons/webxr/XRButton.js";
import { DRACOLoader } from "three/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/loaders/GLTFLoader.js";

let container;
let camera, scene, renderer;
let controller;
let reticle;

let hitTestSource = null;
let hitTestSourceRequested = false;

const modelPath = "models/logoOficyna05.glb";
const models = [];
const clientScene = [];

const whichModel = 0;

const ws = new WebSocket("wss://jvmh62-3000.csb.app");
//
class FadingObject3D extends THREE.Object3D {
  constructor(material, ws) {
    super();
    this.material =
      material ||
      new THREE.MeshStandardMaterial({
        transparent: true, // Ensure transparency is enabled by default
        opacity: 1, // Start fully opaque
      });
    this._isVisible = true; // Control visibility through internal state
    this.fadeDuration = 5000;
    this.fadeInterval = null;
    this.isFadingOut = false; // New property to track fading status
    this.isCompleted = false;
    this.ws = ws; // WebSocket connection
  }

  get visible() {
    return this._isVisible;
  }

  set visible(value) {
    if (value !== this._isVisible) {
      this._isVisible = value;
      if (value) {
        if (this.material) {
          this.children[0].material.opacity = 1; // Reset opacity
          this.children[0].material.transparent = true;
        }
        if (this.fadeInterval) {
          clearInterval(this.fadeInterval); // Stop any ongoing fading
          this.fadeInterval = null;
        }
        super.visible = true; // Ensure the Three.js visibility is synced
      } else {
        this.fadeOut(); // Start fading only when setting to false
      }
    }
  }

  show() {
    if (this.material) {
      this.isCompleted = true;

      this.children[0].material.opacity = 1; // Reset opacity when made visible
      this.stopFading(); // Stop any ongoing fading effect
    }
    super.visible = true; // Ensure the Three.js visible property is synced
  }

  initiateFadeOut() {
    this.fadeOut(); // Start fading out
  }

  fadeOut() {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval); // Clear existing interval if any
    }
    this.isFadingOut = true; // Update fading status
    const step = 1 / (this.fadeDuration / 100);
    const opacity = this.children[0].material.opacity;
    this.fadeInterval = setInterval(() => {
      if (this.children[0].material.opacity > 0) {
        this.children[0].material.opacity -= step;
      } else {
        this.completeFadeOut();
      }
    }, 100);
  }

  completeFadeOut() {
    clearInterval(this.fadeInterval);
    this.fadeInterval = null;
    this.children[0].material.opacity = 1; // Ensure opacity is zero/// 0
    this.isFadingOut = false;
    super.visible = false; // Make object not visible in Three.js context///false
    this.isCompleted = true;
    this.notifyServer(this.name, false);
  }

  stopFading() {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
      this.children[0].material.opacity = 1; // Reset opacity
      this.isFadingOut = false;
      this.isCompleted = true;
      this.notifyServer(this.name, false);
    }
  }

  notifyServer(objectName, isVisible) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "updateVisibility",
        name: objectName,
        visible: isVisible,
      });
      this.ws.send(message);
    } else {
      console.log("WebSocket is not connected.");
    }
  }
}

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  document.body.appendChild(
    XRButton.createButton(renderer, {
      requiredFeatures: ["hit-test"],
    })
  );

  //
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial()
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  //
  document.addEventListener("keydown", (event) => {
    if (event.key === "f") {
      // Press 'f' to trigger fade out
      // console.log("Direct fade out triggered via key press.", fadingObject);
      //fadingObject.fadeOut();
    } else if (event.key === "a") {
      // console.log("Direct vidible triggered via key press.", fadingObject);
      // fadingObject.visible = true;
      // fadingObject.material.opacity = 1;
    }
  });

  //
  // Example usage:
  loadModel(modelPath, scene).then(({ models, clientScene }) => {
    models.forEach((originalMesh) => {
      let fadingMesh = new FadingObject3D(originalMesh.material.clone(), ws); // Clone the material if necessary

      // Transfer properties
      fadingMesh.geometry = originalMesh.geometry; // Assign the geometry
      fadingMesh.position.copy(originalMesh.position); // Copy position
      fadingMesh.rotation.copy(originalMesh.rotation); // Copy rotation
      fadingMesh.scale.copy(originalMesh.scale); // Copy scale
      fadingMesh.name = originalMesh.name; // Copy name if necessary for identification

      // originalMesh.visible = false;

      originalMesh.name = "";
      const mesh = new THREE.Mesh(
        fadingMesh.geometry,
        originalMesh.material.clone()
      );

      fadingMesh.add(mesh);
      fadingMesh.visible = false;
      scene.add(fadingMesh);
      //
    });
    openWebSocketConnection(clientScene);
  });

  //

  window.addEventListener("resize", onWindowResize);
}

async function loadModel(modelPath, scene) {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("three/draco"); // Set the path to DRACO decoder

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  try {
    const gltf = await loader.loadAsync(modelPath);

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        models.push(child);

        // Create a simplified representation for clientScene
        const { name, position, scale, quaternion } = child;
        clientScene.push({
          name,
          position: position.clone(), // clone the position to avoid reference issues
          quaternion: quaternion.clone(), // clone the quaternion
          scale: scale.clone(), // clone the scale
          visible: false,
        });
      }
    });

    return { models, clientScene }; // Returns both arrays
  } catch (error) {
    console.error("Error loading model:", error);
    return { models: [], clientScene: [] }; // Returns empty arrays in case of error
  }
}

//
function openWebSocketConnection(clientScene) {
  //
  ws.onopen = function () {
    console.log("Connected to the server. sending clientScene! ", clientScene);

    const jsonData = JSON.stringify({
      type: "clientScene",
      clientScene,
    });

    ws.send(jsonData); // Corrected: Send the already stringified jsonData

    setInterval(() => {
      //
      ws.send(JSON.stringify({ type: "ping" }));
    }, 20000); // send ping every 30 seconds
  };

  //
  ws.onerror = function (error) {
    console.error("WebSocket error: ", error);
  };

  //
  ws.onclose = function (event) {
    console.log("WebSocket is closed now.");
  };

  //
  ws.onmessage = function (event) {
    const data = JSON.parse(event.data);

    console.log("message received: ", data);

    //
    switch (data.type) {
      case "pong":
        console.log("Pong received");

        break;
      //
      case "objAdded":
        console.log("objAdded data received:");

        break;
      //
      case "updateScene":
        const { sharedScene } = data;

        updateScene(scene, sharedScene);
        break;

      case "_updateOpacity":
        // const obj = scene.getObjectByName(data.name);
        console.log("update opacity, obj: ", obj);
        if (obj) {
          // startFadeOut(obj, data.targetOpacity);
        }
      //
      default:
        console.log("message unknown: ", data.type);
        break;
    }
  };
}

//
function onSelect(event) {
  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

  session.requestAnimationFrame((time, frame) => {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length > 0) {
      const hitTestResult = hitTestResults[0];
      const pose = hitTestResult.getPose(referenceSpace);

      if (pose && pose.transform && pose.transform.matrix) {
        let objectHandled = false; // Flag to ensure only one object is handled

        scene.traverse(function (obj) {
          const obj2 = scene.getObjectByName(obj.name);
          if (obj2 && obj2.visible) return;
          // Check if the object is a FadingObject3D and not visible
          if (obj instanceof FadingObject3D && !obj.visible && !objectHandled) {
            console.log("obj adding: ", obj.name);

            //
            obj.matrix.fromArray(pose.transform.matrix);
            obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
            obj.visible = true; // This should trigger the fading logic if implemented in the setter
            obj.material.opacity = 1;

            if (Math.abs(obj.position.y) < 1e-5) {
              obj.position.y = 0; // Adjust position as needed
            }

            const data = {
              position: obj.position.toArray(),
              quaternion: obj.quaternion.toArray(),
              scale: obj.scale.toArray(),
            };

            const jsonData = JSON.stringify({
              type: "objAdded",
              name: obj.name,
              visible: true,
              data: data,
            });

            console.log("Preparing to send data to server", jsonData);

            // Check if the WebSocket connection is open
            if (ws.readyState === WebSocket.OPEN) {
              console.log("Connection is open. Sending data...");
              ws.send(jsonData);
            } else {
              handleObjAdded(jsonData, clientScene);
              console.log(
                "Failed to send data: WebSocket is not open. Current state:",
                ws.readyState
              );
              // Optionally, handle the error according to the state
              if (ws.readyState === WebSocket.CONNECTING) {
                console.log("Connection is still being established...");
              } else if (ws.readyState === WebSocket.CLOSING) {
                console.log("Connection is closing...");
              } else if (ws.readyState === WebSocket.CLOSED) {
                console.log("Connection is closed. Attempting to reconnect...");
                // Optionally, try to reconnect or notify the user
              }
            }

            objectHandled = true;
          }
        });

        if (!objectHandled) {
          console.log("No suitable FadingObject3D found to make visible.");
        }

        reticle.visible = true;
      } else {
        console.log("Invalid pose or matrix");
        reticle.visible = false;
      }
    } else {
      console.log("No hit test results");
      reticle.visible = false;
    }
  });
}

function updateScene(scene, sharedScene) {
  sharedScene.forEach((item) => {
    // Find the object in the scene by name
    const object = scene.getObjectByName(item.name);

    if (object) {
      //console.log("object do update: ", object);

      if (object.isFadingOut) {
        console.log("The object is currently fading out.");
      } else {
        console.log("The object is not fading out.");
      }

      // Update position if provided
      if (item.position && Array.isArray(item.position)) {
        object.position.set(...item.position);
      }

      // Update quaternion (rotation) if provided
      if (item.quaternion && typeof item.quaternion === "object") {
        object.quaternion.set(
          item.quaternion._x,
          item.quaternion._y,
          item.quaternion._z,
          item.quaternion._w
        );
      }

      // Update scale if provided
      if (item.scale && Array.isArray(item.scale)) {
        object.scale.set(...item.scale);
      }

      // Update visibility if provided
      if (typeof item.visible === "boolean") {
        object.visible = item.visible;

        //object.material.opacity = 1;
      }

      //object.material.opacity = 1;
      if (object.visible && !object.isFadingOut) {
        console.log("isVisible", object.children[0]);
        //object.material.opacity = 1;
        //object.children[0].material.opacity = 0;
        object.fadeOut();
      }

      //
    } else {
      console.log(`Object named ${item.name} not found in the scene.`);
    }
  });
}

//
function handleObjAdded(data, sharedScene) {
  const newData = JSON.parse(data);
  const originalData = sharedScene.find(
    (item) => item.name === newData.data.name
  );
  console.log("new data", newData, sharedScene, originalData);
  if (newData.type !== "objAdded") return;
  // Update the position and scale directly
  //
  console.log("new data przeszło", newData, sharedScene);

  //
  originalData.position = newData.data.position;

  originalData.scale = newData.data.scale;

  // Update visibility
  originalData.visible = newData.visible;

  // Update the rotation quaternion; renaming 'rotation' to 'quaternion'/
  originalData.quaternion = {
    _x: newData.data.quaternion[0],
    _y: newData.data.quaternion[1],
    _z: newData.data.quaternion[2],
    _w: newData.data.quaternion[3],
  };
  //
  console.log("updated sharedScene: ", sharedScene); ///////////
  ////
  updateScene(scene, sharedScene);
  //
  /*
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "updateScene",
          sharedScene,
        })
      );
    }
  });
  */
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace("viewer").then(function (referenceSpace) {
        session
          .requestHitTestSource({ space: referenceSpace })
          .then(function (source) {
            hitTestSource = source;
          });
      });

      session.addEventListener("end", function () {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length) {
        const hit = hitTestResults[0];

        //
        //const anchor = new XRAnchor(hit.getPose(referenceSpace));

        reticle.visible = true;

        if (!models || !models[0]) {
          reticle.visible = false;
        }
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}
