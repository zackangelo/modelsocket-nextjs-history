"use client";

import {
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { createEventSource, EventSourceClient } from "eventsource-client";
import { useCallback, useEffect, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";
import { SchemaStream } from "schema-stream";
import { z } from "zod";

import "react-loading-skeleton/dist/skeleton.css";
import { StopIcon } from "@heroicons/react/20/solid";

type SseState = null | "loading" | "streaming" | "done";

export default function Home() {
  const [sse, setSse] = useState<EventSourceClient | null>(null);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [rejection, setRejection] = useState(undefined);
  const [reqEvent, setReqEvent] = useState<string | null>(null);
  const [sseState, setSseState] = useState<SseState>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);

  const schema = z.object({
    rejection: z.optional(z.string()),
    events: z.array(
      z.object({
        timeRange: z.string(),
        description: z.string(),
      })
    ),
  });

  const cancel = useCallback(() => {
    if (sse) {
      sse.close();
    }

    if (sseState === "loading") {
      setSseState(null);
    } else if (sseState === "streaming") {
      setSseState("done");
    }
  }, [sse]);

  const submit = useCallback(async () => {
    const parser = new SchemaStream(schema, { defaultData: { events: [] } });
    const stream = parser.parse();
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    if (reqEvent === null || reqEvent === "") {
      return;
    }

    setSseState("loading");

    let es = createEventSource({
      url: "/api/timeline",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },

      onMessage: ({ data }) => {
        const dataJson = JSON.parse(data);

        if (dataJson.text && dataJson.text != "") {
          writer.write(dataJson.text);

          const el = scrollContainer.current;
          if (el) {
            el.scrollTo(0, el.scrollHeight);
          }
        }

        if (dataJson.done) {
          es.close();
          writer.close();
        }

        if (dataJson.error) {
          writer.abort(dataJson.error);
          es.close();
        }
      },
      body: JSON.stringify({
        stream: true,
        params: {
          event: reqEvent,
        },
      }),
    });

    setSse(es);

    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        setSseState("done");
        break;
      }

      const chunkValue = decoder.decode(value);
      const outputJson = JSON.parse(chunkValue);

      const timelineEvents = outputJson.events;
      const rejection = outputJson.rejection;

      if (timelineEvents.length > 0 || rejection) {
        setSseState("streaming");
      }

      setTimelineEvents(timelineEvents);
      setRejection(rejection);
    }
  }, [reqEvent]);

  return (
    <div className="w-full h-screen flex items-center justify-center border">
      <div className="rounded-lg bg-white shadow max-w-2xl w-full transition-[height] ease-in duration-500">
        <div className="px-4 py-5 sm:px-6">
          <div className="flex w-full">
            <div className="flex-1">
              <label htmlFor="historicalEvent" className="sr-only">
                Historical Event
              </label>
              <input
                id="historicalEvent"
                name="historicalEvent"
                type="historicalEvent"
                placeholder="The Sinking of the Titanic"
                onChange={(e) => setReqEvent(e.target.value)}
                className="block w-full rounded-md border-0 px-2.5 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-inset focus:ring-slate-50 sm:text-sm sm:leading-6"
              />
            </div>
            <div className="pl-1">
              <SearchOrCancelButton
                state={sseState}
                onSubmit={submit}
                onCancel={cancel}
              />
            </div>
          </div>
        </div>

        {sseState !== null && (
          <div className="px-4 py-5 sm:p-6 flex justify-center">
            <div
              ref={scrollContainer}
              className="w-5/6 max-h-96 overflow-scroll"
            >
              {sseState === "loading" && <LoadingSkeleton />}

              {(sseState === "streaming" || sseState === "done") && (
                <div className="text-sm text-gray-800">
                  <Timeline rejection={rejection} events={timelineEvents} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton(props: { className?: string }) {
  return (
    <div className={`${props.className}`}>
      {[...Array(4)].map((e, i) => (
        <div className="flex mb-6" key={i}>
          <div className="w-3 h-3">
            <Skeleton
              circle
              height="100%"
              containerClassName="avatar-skeleton"
            />
          </div>
          <div className="flex-1 pl-4">
            <h3>
              <Skeleton />
            </h3>
            <p>
              <Skeleton count={2} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline(props: { rejection?: string; events: any[] }) {
  const { events } = props;
  return (
    <ul role="list" className="space-y-6">
      {props.rejection && <RejectionError rejection={props.rejection} />}

      {events.map((event, idx) => (
        <TimelineEvent
          key={idx}
          event={event}
          isLast={idx == events.length - 1}
        />
      ))}
    </ul>
  );
}

function RejectionError(props: { rejection: string }) {
  const { rejection } = props;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger the fade-in effect on mount
    setIsVisible(true);
  }, []);

  return (
    <li
      className={`relative flex gap-x-4 transition-opacity ease-in duration-700 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className={`h-6 absolute left-0 top-0 flex w-6 justify-center`}>
        <div className="w-px bg-gray-200" />
      </div>

      <div className="relative flex h-6 w-6 flex-none items-center justify-center bg-white">
        <ExclamationCircleIcon
          aria-hidden="true"
          className="h-6 w-6 text-yellow-500"
        />
      </div>

      <div>
        <p className="text-gray-600 text-sm">{rejection}</p>
      </div>
    </li>
  );
}

function TimelineEvent(props: { event: any; isLast: boolean }) {
  const { event, isLast } = props;

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger the fade-in effect on mount
    setIsVisible(true);
  }, []);

  return (
    <li
      className={`relative flex gap-x-4 transition-opacity ease-in duration-700 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`${isLast ? "h-6" : "-bottom-6"} 
        absolute left-0 top-0 flex w-6 justify-center`}
      >
        <div className="w-px bg-gray-200" />
      </div>

      <div className="relative flex h-6 w-6 flex-none items-center justify-center bg-white">
        <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300" />
      </div>

      <div>
        <h3 className="text-gray-900 text-md">{event.timeRange}</h3>
        <p className="text-gray-600 text-sm">{event.description}</p>
      </div>
    </li>
  );
}

function SearchOrCancelButton(props: {
  state: SseState;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { state, onSubmit, onCancel } = props;
  const buttonCls =
    "rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50";

  const isSubmitBtn = state === null || state === "done";
  const isCancelBtn = state === "loading" || state === "streaming";

  return (
    <>
      {isSubmitBtn && (
        <button type="button" onClick={onSubmit} className={buttonCls}>
          <MagnifyingGlassIcon className="stroke-slate-500 w-5 h-5" />
        </button>
      )}

      {isCancelBtn && (
        <button type="button" onClick={onCancel} className={buttonCls}>
          <StopIcon className="stroke-slate-500 w-5 h-5" />
        </button>
      )}
    </>
  );
}
