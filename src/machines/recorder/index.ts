import { type ListenLiveClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { assign, enqueueActions, fromPromise, setup } from "xstate";
import { VISUALIZER_CONFIG } from "./config";

interface DeepgramResponseData {
  channel: {
    alternatives: Array<{
      transcript: string;
    }>;
  };
  is_final: boolean;
}

interface RecorderContext {
  transcripts: DeepgramResponseData[];
  microphone: MediaRecorder | null;
  socket: ListenLiveClient | null;
  prefetchedKey: string | null;
  error: Error | null;
  stream: MediaStream | null;
  pendingStartClick: boolean;
  language: SupportedLanguage;
  audioChunks: Blob[];
  recordedAudio: Blob | null;
  audioUrl: string | null;
  elapsedTime: number;
  analyser: AnalyserNode | null;
  dataArray: Float32Array | null;
  analyzerFrameId: number | null;
  audioContext: AudioContext | null;
}

const fetchKeyFunc = async () => {
  const response = await fetch("http://localhost:3000/key");
  const data = await response.json();
  return data.key;
};

const initialize = async ({
  input,
}: {
  input: { prefetchedKey: string | null; language: SupportedLanguage };
}) => {
  const apiKey = input?.prefetchedKey ?? (await fetchKeyFunc());

  const [{ microphone, stream }, socket] = await Promise.all([
    getMicrophone(),
    initializeDeepgram(apiKey, input.language),
  ]);

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  source.connect(analyser);

  analyser.fftSize = VISUALIZER_CONFIG.analyzer.fftSize;
  analyser.smoothingTimeConstant =
    VISUALIZER_CONFIG.analyzer.smoothingTimeConstant;
  analyser.minDecibels = VISUALIZER_CONFIG.analyzer.minDecibels;
  analyser.maxDecibels = VISUALIZER_CONFIG.analyzer.maxDecibels;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Float32Array(bufferLength).fill(
    VISUALIZER_CONFIG.analyzer.defaultValue,
  );

  return {
    microphone,
    socket,
    stream,
    analyser,
    dataArray,
    audioContext,
  } as const;
};

export type SupportedLanguage = "ru-RU" | "en-US" | "es-ES" | "fr-FR" | "de-DE";

type RecorderEvent =
  | { type: "HOVER" }
  | { type: "CLICK" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "KEY_FETCHED"; key: string }
  | { type: "INITIALIZED"; microphone: MediaRecorder; socket: ListenLiveClient }
  | { type: "TRANSCRIPT_RECEIVED"; data: DeepgramResponseData }
  | { type: "ERROR"; error: Error }
  | { type: "CHANGE_LANGUAGE"; language: SupportedLanguage }
  | { type: "AUDIO_DATA"; data: Blob };

type RecorderActor = {
  send: (event: RecorderEvent) => void;
};

export const recorderMachine = setup({
  types: {
    context: {} as RecorderContext,
    events: {} as RecorderEvent,
  },
  guards: {
    checkPendingStartClick: ({ context }) => context.pendingStartClick,
  },
  actions: {
    startRecording: ({ context, self }) => {
      if (
        context.microphone &&
        context.socket &&
        context.microphone.state === "inactive"
      ) {
        startRecording(context.microphone, context.socket, self);
      }
    },
    stopRecording: ({ context }) => {
      if (context.microphone) {
        context.microphone.stop();
      }
      if (context.socket) {
        context.socket.requestClose();
      }
      if (context.stream) {
        for (const track of context.stream.getTracks()) {
          track.stop();
        }
      }
      if (context.audioContext) {
        context.audioContext.close();
      }
      if (context.analyser) {
        context.analyser.disconnect();
      }
    },
    invalidateKey: assign({
      prefetchedKey: () => null,
      error: () => null,
    }),
    setPendingStartClick: assign({
      pendingStartClick: () => true,
    }),
    resetSavedState: assign({
      audioUrl: () => null,
      transcripts: () => [],
    }),
    pauseRecording: ({ context }) => {
      if (context.microphone && context.microphone.state === "recording") {
        context.microphone.pause();
      }
    },
    resumeRecording: ({ context }) => {
      if (context.microphone && context.microphone.state === "paused") {
        context.microphone.resume();
      }
    },
    startAnalyzer: enqueueActions(({ context, enqueue }) => {
      if (context.analyser && context.dataArray) {
        context.analyser.getFloatFrequencyData(context.dataArray);
        for (let i = 0; i < context.dataArray.length; i++) {
          if (context.dataArray[i] === Number.NEGATIVE_INFINITY) {
            context.dataArray[i] = -100;
          }
        }
        const frameId = requestAnimationFrame(function updateAnalyzer() {
          if (context.analyser && context.dataArray) {
            context.analyser.getFloatFrequencyData(context.dataArray);
            for (let i = 0; i < context.dataArray.length; i++) {
              if (context.dataArray[i] === Number.NEGATIVE_INFINITY) {
                context.dataArray[i] = -100;
              }
            }
            return requestAnimationFrame(updateAnalyzer);
          }
        });

        enqueue.assign({
          analyzerFrameId: frameId,
        });
      }
    }),
    stopAnalyzer: enqueueActions(({ context, enqueue }) => {
      if (context.analyzerFrameId !== null) {
        cancelAnimationFrame(context.analyzerFrameId);

        enqueue.assign({
          analyzerFrameId: null,
        });
      }
    }),
    tick: assign(({ context }) => ({
      elapsedTime: context.elapsedTime + 1,
    })),
  },
  actors: {
    fetchKey: fromPromise<string>(fetchKeyFunc),
    initialize: fromPromise<
      {
        microphone: MediaRecorder;
        socket: ListenLiveClient;
        stream: MediaStream;
        analyser: AnalyserNode;
        dataArray: Float32Array;
        audioContext: AudioContext;
      },
      { prefetchedKey: string | null; language: SupportedLanguage }
    >(initialize),
  },
}).createMachine({
  id: "recorder",
  context: {
    transcripts: [],
    microphone: null,
    socket: null,
    prefetchedKey: null,
    error: null,
    stream: null,
    pendingStartClick: false,
    language: "ru-RU" as SupportedLanguage,
    audioChunks: [],
    recordedAudio: null,
    audioUrl: null,
    elapsedTime: 0,
    analyser: null,
    dataArray: null,
    analyzerFrameId: null,
    audioContext: null,
  },
  initial: "idle",
  states: {
    idle: {
      on: {
        HOVER: {
          target: "prefetching",
        },
      },
    },
    prefetching: {
      invoke: {
        id: "fetchKey",
        src: "fetchKey",
        onDone: [
          {
            guard: "checkPendingStartClick",
            target: "initializing",
            actions: [
              assign({
                prefetchedKey: ({ event }) => event.output,
                pendingStartClick: () => false,
              }),
            ],
          },
          {
            target: "ready",
            actions: assign({
              prefetchedKey: ({ event }) => event.output,
            }),
          },
        ],
        onError: {
          target: "idle",
          actions: assign({
            error: ({ event }) => event.error as Error,
          }),
        },
      },
      on: {
        CLICK: {
          actions: ["setPendingStartClick", "resetSavedState"],
        },
      },
    },
    ready: {
      after: {
        20000: {
          target: "idle",
          actions: "invalidateKey",
        },
      },
      on: {
        CLICK: {
          target: "initializing",
          actions: ["resetSavedState"],
        },
      },
    },
    initializing: {
      invoke: {
        id: "initialize",
        src: "initialize",
        input: ({ context }) => ({
          prefetchedKey: context.prefetchedKey,
          language: context.language,
        }),
        onDone: {
          target: "recording",
          actions: assign({
            microphone: ({ event }) => event.output.microphone as MediaRecorder,
            socket: ({ event }) => event.output.socket as ListenLiveClient,
            stream: ({ event }) => event.output.stream as MediaStream,
            analyser: ({ event }) => event.output.analyser as AnalyserNode,
            dataArray: ({ event }) => event.output.dataArray as Float32Array,
            audioContext: ({ event }) =>
              event.output.audioContext as AudioContext,
            prefetchedKey: () => null,
          }),
        },
        onError: {
          target: "idle",
          actions: assign({
            error: ({ event }) => event.error as Error,
          }),
        },
      },
    },
    recording: {
      entry: [{ type: "startRecording" }, { type: "startAnalyzer" }],
      on: {
        TRANSCRIPT_RECEIVED: {
          actions: assign({
            transcripts: ({ context, event }) => {
              if (!event) return context.transcripts;
              return [...context.transcripts, event.data];
            },
          }),
        },
        AUDIO_DATA: {
          actions: assign({
            audioChunks: ({ context, event }) => [
              ...context.audioChunks,
              event.data,
            ],
          }),
        },
        CLICK: {
          target: "idle",
        },
      },
      initial: "active",
      states: {
        active: {
          after: {
            1000: {
              target: "ticking",
            },
          },
          on: {
            TOGGLE_PAUSE: {
              target: "paused",
              actions: [{ type: "pauseRecording" }, { type: "stopAnalyzer" }],
            },
          },
        },
        ticking: {
          entry: {
            type: "tick",
          },
          always: {
            target: "active",
          },
        },
        paused: {
          on: {
            TOGGLE_PAUSE: {
              target: "active",
              actions: [{ type: "resumeRecording" }, { type: "startAnalyzer" }],
            },
          },
        },
      },
      exit: [
        { type: "stopRecording" },
        { type: "stopAnalyzer" },
        assign({
          microphone: () => null,
          socket: () => null,
          pendingStartClick: () => false,
          audioChunks: () => [],
          stream: () => null,
          prefetchedKey: () => null,
          elapsedTime: 0,
          analyser: () => null,
          dataArray: () => null,
          audioContext: () => null,
          recordedAudio: ({ context }) =>
            new Blob(context.audioChunks, { type: "audio/webm" }),
          audioUrl: ({ context }) => {
            if (context.audioUrl) {
              URL.revokeObjectURL(context.audioUrl);
            }
            const blob = new Blob(context.audioChunks, { type: "audio/webm" });
            return URL.createObjectURL(blob);
          },
        }),
      ],
    },
  },
  on: {
    CHANGE_LANGUAGE: {
      actions: assign({
        language: ({ event }) => event.language,
      }),
    },
  },
});

async function getMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      sampleSize: 16,
    },
  });

  const microphone = new MediaRecorder(stream, {
    mimeType: "audio/webm",
    audioBitsPerSecond: 16000,
  });

  return { microphone, stream };
}

function startRecording(
  microphone: MediaRecorder,
  socket: ListenLiveClient,
  actor: RecorderActor,
) {
  microphone.ondataavailable = (e) => {
    const data = e.data;
    if (data.size > 0) {
      socket.send(data);
      actor.send({ type: "AUDIO_DATA", data });
    }
  };

  socket.on(
    LiveTranscriptionEvents.Transcript,
    (data: DeepgramResponseData) => {
      try {
        console.log("transcript received", data);
        actor.send({ type: "TRANSCRIPT_RECEIVED", data });
      } catch (error) {
        console.error("Error processing transcript:", error);
      }
    },
  );

  socket.on(LiveTranscriptionEvents.Error, (error) => {
    console.error("Socket error:", error);
    actor.send({ type: "ERROR", error: new Error(String(error)) });
  });

  socket.on(LiveTranscriptionEvents.Metadata, (e) => console.warn(e));
  socket.on(LiveTranscriptionEvents.Close, () => {
    console.log("Socket closed");
  });

  microphone.onstart = () => {
    console.log("Microphone started recording");
  };

  microphone.onerror = (e) => {
    console.error("Microphone error:", e);
  };

  microphone.onstop = () => {
    console.log("Microphone stopped recording");
  };

  microphone.onpause = () => {
    console.log("Microphone paused recording");
  };

  microphone.onresume = () => {
    console.log("Microphone resumed recording");
  };

  microphone.start(250);
}

async function initializeDeepgram(apiKey: string, language: SupportedLanguage) {
  const { createClient, LiveTranscriptionEvents } = await import(
    "@deepgram/sdk"
  );

  const client = createClient(apiKey);
  const newSocket = client.listen.live({
    model: "nova-2",
    smart_format: true,
    interim_results: true,
    language,
  });

  return new Promise<ListenLiveClient>((resolve, reject) => {
    newSocket.on(LiveTranscriptionEvents.Open, () => {
      console.log("client: connected to websocket");
      const keepAliveInterval = setInterval(() => {
        newSocket.keepAlive();
        console.log("keepAlive sent");
      }, 3000);

      newSocket.on(LiveTranscriptionEvents.Close, () => {
        console.log("Socket closed");
        clearInterval(keepAliveInterval);
      });

      resolve(newSocket);
    });

    newSocket.on(LiveTranscriptionEvents.Error, reject);
  });
}
