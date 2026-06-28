"use client";

import { useCallback, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant,
  ConnectionLineType,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import AgentNodeComponent from "./AgentNode";
import { AgentNode as AgentNodeType } from "@/lib/types";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 150;

function layoutTree(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 30 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: laidOut, edges };
}

const nodeTypes = { agent: AgentNodeComponent };

interface AgentTreeInnerProps {
  agents: Map<string, AgentNodeType>;
  onSelectAgent?: (id: string) => void;
  selectedAgentId?: string | null;
}

function AgentTreeInner({
  agents,
  onSelectAgent,
  selectedAgentId,
}: AgentTreeInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const fitViewTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const lastZoomedJudgeId = useRef<string | null>(null);
  const prevNodeCount = useRef(0);

  const tierColors: Record<string, string> = useMemo(
    () => ({
      opus: "#a855f7",
      sonnet: "#3b82f6",
      haiku: "#10b981",
    }),
    [],
  );

  const updateLayout = useCallback(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    agents.forEach((agent) => {
      rawNodes.push({
        id: agent.id,
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: agent.label,
          model: agent.model,
          status: agent.status,
          task: agent.task,
          result: agent.result,
          onSelect: onSelectAgent,
          nodeId: agent.id,
          selected: selectedAgentId === agent.id,
          specialty: agent.specialty,
          customSpecialist: agent.customSpecialist,
          debateRole: agent.debateRole,
          debateRound: agent.debateRound,
          isEye: agent.isEye,
          secondOpinion: agent.secondOpinion,
        },
      });

      if (agent.parentId) {
        const edgeColor = agent.isEye
          ? "#06b6d4"
          : agent.debateRole === "bull"
          ? "#ef4444"
          : agent.debateRole === "bear"
            ? "#3b82f6"
            : agent.debateRole === "judge"
              ? "#f59e0b"
              : agent.debateRole === "topic"
                ? "#f59e0b"
                : agent.customSpecialist
                  ? "#d946ef"
                  : tierColors[agent.model] || "#666";
        rawEdges.push({
          id: `${agent.parentId}->${agent.id}`,
          source: agent.parentId,
          target: agent.id,
          animated: agent.status !== "complete",
          type: "smoothstep",
          style: {
            stroke: edgeColor,
            strokeWidth: agent.customSpecialist ? 2.5 : 2,
          },
        });
      }
    });

    if (rawNodes.length === 0) return;

    const { nodes: laidOut, edges: laidOutEdges } = layoutTree(
      rawNodes,
      rawEdges,
    );
    setNodes(laidOut);
    setEdges(laidOutEdges);

    const nodeCountChanged = rawNodes.length !== prevNodeCount.current;
    prevNodeCount.current = rawNodes.length;

    // Detect a fresh judge completion → zoom in on judge + topic + Round 1.
    const allAgents = Array.from(agents.values());
    const judge = allAgents.find(
      (a) => a.debateRole === "judge" && a.status === "complete",
    );
    const judgeJustCompleted = judge && judge.id !== lastZoomedJudgeId.current;

    if (judgeJustCompleted) {
      lastZoomedJudgeId.current = judge.id;
      const topic = allAgents.find((a) => a.id === judge.parentId);
      const bullR1 = allAgents.find(
        (a) =>
          a.debateRole === "bull" &&
          a.debateRound === 1 &&
          a.parentId === topic?.id,
      );
      const bearR1 = allAgents.find(
        (a) =>
          a.debateRole === "bear" &&
          a.debateRound === 1 &&
          a.parentId === topic?.id,
      );
      const focusIds = [judge.id, topic?.id, bullR1?.id, bearR1?.id].filter(
        (x): x is string => typeof x === "string",
      );
      if (fitViewTimer.current) clearTimeout(fitViewTimer.current);
      fitViewTimer.current = setTimeout(() => {
        fitView({
          padding: 0.3,
          duration: 900,
          nodes: focusIds.map((id) => ({ id })),
        });
      }, 200);
    } else if (nodeCountChanged) {
      if (fitViewTimer.current) clearTimeout(fitViewTimer.current);
      fitViewTimer.current = setTimeout(() => {
        fitView({ padding: 0.2, duration: 400 });
      }, 100);
    }
  }, [agents, setNodes, setEdges, tierColors, fitView, onSelectAgent, selectedAgentId]);

  useEffect(() => {
    updateLayout();
  }, [updateLayout]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={1.5}
      onPaneClick={() => onSelectAgent?.("")}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#333"
      />
      <Controls
        showInteractive={false}
        className="!bg-zinc-800/80 !border-white/10 !rounded-lg !shadow-xl"
      />
    </ReactFlow>
  );
}

interface AgentTreeProps {
  agents: Map<string, AgentNodeType>;
  onSelectAgent?: (id: string) => void;
  selectedAgentId?: string | null;
}

export default function AgentTree({
  agents,
  onSelectAgent,
  selectedAgentId,
}: AgentTreeProps) {
  return (
    <div className="w-full h-full">
      <ReactFlowProvider>
        <AgentTreeInner
          agents={agents}
          onSelectAgent={onSelectAgent}
          selectedAgentId={selectedAgentId}
        />
      </ReactFlowProvider>
    </div>
  );
}
