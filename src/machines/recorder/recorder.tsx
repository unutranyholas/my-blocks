import { useMachine } from "@xstate/react";
import { recorderMachine, type DeepgramResponseData } from "./machine";
import { AudioVisualizer } from "./visualizer";


function secondsToTimeString(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}


export const processTranscriptToString = (
  data: DeepgramResponseData[],
): string => {
  const chunks: {
    transcript: string;
    is_final: boolean;
  }[][] = [[]];

  for (const x of data) {
    const transcript = x.channel.alternatives[0].transcript;
    const is_final = x.is_final;

    chunks[chunks.length - 1].push({ transcript, is_final });

    if (is_final) {
      chunks.push([]);
    }
  }

  const lastChunk = chunks.pop() ?? [];

  let result = "";

  for (const x of chunks) {
    const last = x.at(-1) as { transcript: string; is_final: true };
    result += `${last.transcript} `;
  }

  if (lastChunk.length > 0) {
    result += lastChunk.at(-1)?.transcript ?? "";
  }

  return result.trim();
};


export const Recorder = () => {
  const [state, send] = useMachine(recorderMachine);

  const { isRecording, isPaused, transcripts, audioUrl } = {
    isRecording: state.matches("recording"),
    isPaused: state.matches({ recording: "paused" }),
    transcripts: state.context.transcripts,
    audioUrl: state.context.audioUrl,
  };

  const handleMouseEnter = () => {
    send({ type: "HOVER" });
  };


  const handleStartClick = () => {
    send({ type: "CLICK" });
  };

  const handlePauseResume = () => {
    send({ type: "TOGGLE_PAUSE" });
  };

  const transcript = processTranscriptToString(state.context.transcripts);

  return (
    <div>
      <button type="button" onClick={handleStartClick} onMouseEnter={handleMouseEnter}>
        {isRecording ? "Stop Recording" : "Start Recording"}{" "}
        {isRecording && <span>{secondsToTimeString(state.context.elapsedTime)}</span>}
      </button>

      {isRecording && (
        <>
          <button type="button" onClick={handlePauseResume}>
            {isPaused ? "Resume" : "Pause"}
          </button>
          <AudioVisualizer
            dataArray={state.context.dataArray}
            isRecording={isRecording}
            isPaused={isPaused}
          />
        </>
      )}

      {transcripts.length > 0 && (
        <div>
          <h3>Transcripts:</h3>
          <p>{transcript}</p>
        </div>
      )}

      {audioUrl && (
        <div>
          <h3>Recorded Audio:</h3>
          <audio
            controls
            key={audioUrl}
            preload="auto"
          >
            <source src={state.context.audioUrl ?? undefined} type="audio/webm;codecs=opus" />
            <track kind="captions" label="English captions" src="" srcLang="en" />
          </audio>
        </div>
      )}
    </div>
  );
};

export default Recorder;