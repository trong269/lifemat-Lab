import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });
export const usePlugins = () => useQuery({ queryKey: ["plugins"], queryFn: api.plugins, staleTime: 300_000 });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => api.models() });
export const useProviders = () => useQuery({ queryKey: ["providers"], queryFn: api.providers });
export const useDatasets = () => useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
export const useRuns = (refetch = 0) =>
  useQuery({ queryKey: ["runs"], queryFn: api.runs, refetchInterval: refetch || false });
export const useCatalogApps = () => useQuery({ queryKey: ["catalog-apps"], queryFn: api.catalogApps, staleTime: 60_000 });
export const usePrompts = () => useQuery({ queryKey: ["prompts"], queryFn: api.prompts });

/** Danh sách tên bộ luật từ meta. */
export function useRules(): string[] {
  const m = useMeta();
  return m.data?.rules ?? ["rules_v2"];
}
