import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import { connectionStatusBg } from "@/lib/format";
import { useEndpoints } from "@/lib/useEndpoints";
import { Power, PowerOff, RefreshCw, RotateCcw, Zap } from "lucide-react";
import { useState } from "react";

type Action = "on" | "shutdown" | "restart";

export default function PowerManagementPage() {
  const { endpoints, refresh, isRefreshing } = useEndpoints();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    hostname: string;
    action: Exclude<Action, "on">;
  } | null>(null);

  const runAction = async (hostname: string, action: Action) => {
    setBusy(`${hostname}:${action}`);
    setMessage(null);
    try {
      const result = await apiClient.powerAction(hostname, action);
      setMessage(result.message);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Power action failed");
    } finally {
      setBusy(null);
    }
  };

  const requestAction = (hostname: string, action: Action) => {
    if (action === "on") {
      void runAction(hostname, action);
      return;
    }
    setPendingAction({ hostname, action });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="font-display">Endpoint Power</CardTitle>
            <CardDescription>Control only endpoints assigned to this account.</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={refresh} disabled={isRefreshing} aria-label="Refresh endpoints">
            <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </CardHeader>
        <CardContent>
          {message && <p className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">{message}</p>}
          <div className="divide-y divide-border">
            {endpoints.map((endpoint) => {
              const online = endpoint.last_seen > Date.now() - 120000;
              const actionBusy = busy?.startsWith(`${endpoint.hostname}:`);
              return (
                <div key={endpoint.mac_address} className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold">{endpoint.hostname}</p>
                      <Badge className={`rounded-full border-transparent ${connectionStatusBg(online ? "online" : "offline")}`}>
                        {online ? "Online" : "Offline"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{endpoint.ip_address} · {endpoint.mac_address}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {endpoint.wol_enabled === true
                        ? "Wake-on-LAN available"
                        : endpoint.wol_enabled === false
                          ? "Wake-on-LAN disabled"
                          : "Wake-on-LAN status unknown"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!online && (
                      <Button size="sm" variant="outline" disabled={Boolean(actionBusy) || endpoint.wol_enabled !== true} onClick={() => requestAction(endpoint.hostname, "on")}>
                        <Zap className="mr-2 size-4" /> Wake
                      </Button>
                    )}
                    {online && (
                      <>
                        <Button size="sm" variant="outline" disabled={Boolean(actionBusy)} onClick={() => requestAction(endpoint.hostname, "restart")}>
                          <RotateCcw className="mr-2 size-4" /> Restart
                        </Button>
                        <Button size="sm" variant="destructive" disabled={Boolean(actionBusy)} onClick={() => requestAction(endpoint.hostname, "shutdown")}>
                          <PowerOff className="mr-2 size-4" /> Shut down
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {endpoints.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground"><Power className="mx-auto mb-2 size-5" />No endpoints available.</div>}
        </CardContent>
      </Card>
      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === "shutdown" ? "Shut down" : "Restart"} endpoint?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.hostname} will receive this command from the monitoring agent. This action may interrupt active work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={pendingAction?.action === "shutdown" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={() => {
                if (pendingAction) void runAction(pendingAction.hostname, pendingAction.action);
                setPendingAction(null);
              }}
            >
              Confirm {pendingAction?.action === "shutdown" ? "shutdown" : "restart"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}