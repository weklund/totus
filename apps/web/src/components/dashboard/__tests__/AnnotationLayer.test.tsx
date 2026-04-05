// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnnotationLayer } from "../AnnotationLayer";
import type { Annotation } from "@/lib/dashboard/types";

const MOCK_ANNOTATIONS: Annotation[] = [
  {
    id: 1,
    source: "user",
    event_type: "meal",
    label: "Late dinner",
    note: "Pizza at 9:30 PM",
    occurred_at: "2026-03-27T21:30:00Z",
    ended_at: null,
  },
  {
    id: 2,
    source: "oura",
    event_type: "workout",
    label: "Evening run",
    note: null,
    occurred_at: "2026-03-27T23:00:00Z",
    ended_at: "2026-03-27T23:45:00Z",
  },
];

const START = "2026-03-27T20:00:00Z";
const END = "2026-03-28T08:00:00Z";

describe("AnnotationLayer", () => {
  it("renders vertical markers for each annotation", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    expect(screen.getByTestId("annotation-layer")).toBeInTheDocument();
    const markers = screen.getAllByTestId("annotation-marker");
    expect(markers).toHaveLength(2);
  });

  it("shows correct event type icons", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    const markers = screen.getAllByTestId("annotation-marker");
    expect(markers[0]).toHaveTextContent("🍽️");
    expect(markers[1]).toHaveTextContent("🏃");
  });

  it("displays annotation label text instead of event_type", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    const markers = screen.getAllByTestId("annotation-marker");
    // Should show label text, not event_type
    expect(markers[0]).toHaveTextContent("Late dinner");
    expect(markers[1]).toHaveTextContent("Evening run");
    // Should NOT show event_type as visible text
    expect(markers[0]).not.toHaveTextContent("meal");
    expect(markers[1]).not.toHaveTextContent("workout");
  });

  it("shows tooltip on hover with event details", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    const markers = screen.getAllByTestId("annotation-marker");
    fireEvent.mouseEnter(markers[0]);
    const tooltip = screen.getByTestId("annotation-tooltip");
    expect(tooltip).toHaveTextContent("Late dinner");
    expect(tooltip).toHaveTextContent("Pizza at 9:30 PM");
  });

  it("hides tooltip on mouse leave", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    const markers = screen.getAllByTestId("annotation-marker");
    fireEvent.mouseEnter(markers[0]);
    expect(screen.getByTestId("annotation-tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(markers[0]);
    expect(screen.queryByTestId("annotation-tooltip")).not.toBeInTheDocument();
  });

  it("returns null when no annotations", () => {
    const { container } = render(
      <AnnotationLayer annotations={[]} start={START} end={END} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters out annotations outside time range", () => {
    const outOfRange: Annotation[] = [
      {
        id: 3,
        source: "user",
        event_type: "meal",
        label: "Lunch",
        note: null,
        occurred_at: "2026-03-27T12:00:00Z", // Before 8 PM start
        ended_at: null,
      },
    ];
    const { container } = render(
      <AnnotationLayer annotations={outOfRange} start={START} end={END} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows loading skeleton when isLoading is true", () => {
    render(
      <AnnotationLayer annotations={[]} start={START} end={END} isLoading />,
    );
    expect(screen.getByTestId("annotation-layer-loading")).toBeInTheDocument();
  });

  it("shows provider source in tooltip for non-user annotations", () => {
    render(
      <AnnotationLayer
        annotations={MOCK_ANNOTATIONS}
        start={START}
        end={END}
      />,
    );
    const markers = screen.getAllByTestId("annotation-marker");
    fireEvent.mouseEnter(markers[1]);
    expect(screen.getByTestId("annotation-tooltip")).toHaveTextContent(
      "Source: oura",
    );
  });

  // CROSS-024: Boundary-spanning annotations
  describe("CROSS-024: boundary-spanning annotations", () => {
    it("clamps annotations that span the night boundary to chart left edge", () => {
      const boundaryAnnotation: Annotation[] = [
        {
          id: 10,
          source: "user",
          event_type: "workout",
          label: "Evening workout",
          note: null,
          occurred_at: "2026-03-27T19:00:00Z", // 7 PM — before 8 PM start
          ended_at: "2026-03-27T20:30:00Z", // 8:30 PM — after 8 PM start
        },
      ];
      render(
        <AnnotationLayer
          annotations={boundaryAnnotation}
          start={START}
          end={END}
        />,
      );
      // Should render because ended_at overlaps the window
      const markers = screen.getAllByTestId("annotation-marker");
      expect(markers).toHaveLength(1);
      // Marker should be at 0% (left edge)
      const markerContainer = markers[0].closest("[style]");
      expect(markerContainer).toHaveStyle("left: 0%");
    });

    it("excludes annotations before range that don't span into window", () => {
      const beforeRange: Annotation[] = [
        {
          id: 11,
          source: "user",
          event_type: "meal",
          label: "Lunch",
          note: null,
          occurred_at: "2026-03-27T12:00:00Z",
          ended_at: "2026-03-27T13:00:00Z", // Ends before 8 PM
        },
      ];
      const { container } = render(
        <AnnotationLayer annotations={beforeRange} start={START} end={END} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("excludes instant annotations before range start", () => {
      const instantBefore: Annotation[] = [
        {
          id: 12,
          source: "user",
          event_type: "meal",
          label: "Lunch",
          note: null,
          occurred_at: "2026-03-27T12:00:00Z",
          ended_at: null,
        },
      ];
      const { container } = render(
        <AnnotationLayer annotations={instantBefore} start={START} end={END} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
