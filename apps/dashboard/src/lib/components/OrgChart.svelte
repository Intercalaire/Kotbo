<script lang="ts">
  import Papicon from './Papicon.svelte';
  import HierarchyNode from './HierarchyNode.svelte';
  import { m } from '../i18n';

  type HierarchySchema = {
    chiefStaff: { userId?: string | null; roleId?: string | null; name?: string | null } | null;
    hierarchies: Array<{
      id: string;
      name: string;
      description?: string | null;
      color?: string | null;
      icon?: string | null;
      sortOrder?: number | null;
      parentHierarchyId?: string | null;
      responsable?: { userId: string; name?: string | null } | null;
      roles: Array<{ id: string; name: string; level: number; isResponsable: boolean; color?: string | null }>;
      memberCount: number;
      members: Array<{ userId: string; username: string; displayName?: string | null; avatarUrl?: string | null; grade: string }>;
    }>;
  };

  const { schema }: { schema: HierarchySchema } = $props();

  type HierarchyTreeNode = HierarchySchema['hierarchies'][number] & {
    children: HierarchyTreeNode[];
  };

  function buildHierarchyTree(): HierarchyTreeNode[] {
    const nodeMap = new Map<string, HierarchyTreeNode>();

    for (const hierarchy of schema?.hierarchies ?? []) {
      nodeMap.set(hierarchy.id, { ...hierarchy, children: [] });
    }

    const roots: HierarchyTreeNode[] = [];

    for (const node of nodeMap.values()) {
      const parentId = node.parentHierarchyId ?? null;
      const parentNode = parentId ? nodeMap.get(parentId) : null;

      if (parentNode) {
        parentNode.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: HierarchyTreeNode[]) => {
      nodes.sort((left, right) => {
        const leftOrder = left.sortOrder ?? 0;
        const rightOrder = right.sortOrder ?? 0;
        return (leftOrder - rightOrder) || left.name.localeCompare(right.name);
      });
      nodes.forEach((node) => {
        node.children = sortNodes(node.children);
      });
      return nodes;
    };

    return sortNodes(roots);
  }

  const hierarchyTree = $derived(buildHierarchyTree());
</script>

<div class="org-chart-container py-16 px-8 overflow-x-auto select-none">
  {#if !schema || !schema.hierarchies || schema.hierarchies.length === 0}
    <div class="flex flex-col items-center justify-center py-20 text-on-surface-variant/30 border-2 border-dashed border-outline-variant/10 rounded-xl bg-surface-container-low/20">
      <div class="w-20 h-20 rounded-xl bg-surface-container flex items-center justify-center mb-6 shadow-inner opacity-50">
        <Papicon icon="schema" size={32} />
      </div>
      <h3 class="text-xl font-semibold tracking-tight text-on-surface/40">{m.staff_orgchart_empty_title()}</h3>
      <p class="mt-2 text-xs opacity-50">{m.staff_orgchart_empty_desc()}</p>
    </div>
  {:else}
    <div class="tree-canvas flex flex-col items-center min-w-max">
      <!-- Chief Staff Node -->
      {#if schema.chiefStaff && (schema.chiefStaff.name || schema.chiefStaff.userId)}
        <div class="chief-staff-node mb-8 flex flex-col items-center">
          <div class="chief-staff-card group relative p-6 pt-8 rounded-2xl bg-linear-to-br from-amber-500/10 to-yellow-600/5 border border-amber-500/30 backdrop-blur-md max-w-sm text-center">
            <div class="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-linear-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center shadow-lg border border-amber-300/30 group-hover:scale-110 transition-transform duration-300">
              <Papicon icon="crown" size={22} />
            </div>
            <div class="mt-2">
              <span class="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wider">
                {m.staff_orgchart_global_chief()}
              </span>
              <p class="text-lg font-bold text-on-surface mt-2 tracking-tight">{schema.chiefStaff.name || m.staff_orgchart_unknown_name()}</p>
              {#if schema.chiefStaff.userId}
                <span class="text-[10px] font-mono text-on-surface-variant/40 bg-surface-container-high/40 px-2 py-0.5 rounded-md mt-1.5 inline-block">
                  ID: {schema.chiefStaff.userId}
                </span>
              {/if}
            </div>
          </div>
          <div class="vertical-connector bg-linear-to-b from-amber-500/40 to-outline-variant"></div>
        </div>
      {/if}

      <!-- Hierarchies Tree -->
      <div class="hierarchies-tree flex items-start gap-12 relative">
        {#each hierarchyTree as hierarchy (hierarchy.id)}
          <div class="flex-1 flex justify-center">
            <HierarchyNode node={hierarchy} isRoot={true} />
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .org-chart-container {
    background-image: radial-gradient(var(--outline-variant) 1px, transparent 1px);
    background-size: 24px 24px;
    background-color: var(--surface-container-lowest);
    border-radius: var(--radius-xl);
    border: 1px solid var(--outline-variant);
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.01);
  }

  .org-chart-container::-webkit-scrollbar {
    height: 8px;
    width: 8px;
  }
  .org-chart-container::-webkit-scrollbar-track {
    background: transparent;
  }
  .org-chart-container::-webkit-scrollbar-thumb {
    background: var(--outline-variant);
    border-radius: 9999px;
  }
  .org-chart-container::-webkit-scrollbar-thumb:hover {
    background: var(--outline);
  }

  .chief-staff-node {
    position: relative;
  }

  .chief-staff-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 32px -6px rgba(245, 158, 11, 0.12), inset 0 0 12px rgba(245, 158, 11, 0.02);
  }
  .chief-staff-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px -6px rgba(245, 158, 11, 0.22), inset 0 0 16px rgba(245, 158, 11, 0.08);
    border-color: rgba(245, 158, 11, 0.5);
  }

  .vertical-connector {
    width: 2px;
    height: 48px;
  }

  .hierarchies-tree {
    padding-top: 0.5rem;
  }
</style>
