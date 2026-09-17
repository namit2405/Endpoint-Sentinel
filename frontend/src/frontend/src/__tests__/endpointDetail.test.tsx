import { renderApp } from "@/test/renderApp";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

async function openDetail(hostname: string) {
  const { user, navigateTo } = renderApp();
  await navigateTo("Inventory");
  await screen.findByText(hostname);
  await user.click(screen.getByRole("link", { name: hostname }));
  return { user };
}

describe("Endpoint Detail page", () => {
  it("renders the header with hostname, OS badge, IP, MAC, and download button", async () => {
    await openDetail("srv-web-01");

    expect(
      screen.getByRole("heading", { name: "srv-web-01" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Linux")).toBeInTheDocument();
    expect(screen.getAllByText("10.0.1.11").length).toBeGreaterThan(0);
    expect(screen.getAllByText("00:1A:2B:3C:4D:01").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Audit report download/ }),
    ).toBeInTheDocument();
  });

  it("renders the hardware section with CPU, RAM, architecture, and disk usage", async () => {
    await openDetail("srv-web-01");

    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument(); // CPU cores
    expect(screen.getByText("Intel Xeon E5-2680 v4")).toBeInTheDocument();
    expect(screen.getByText("32 GB")).toBeInTheDocument();
    expect(screen.getByText("x86_64")).toBeInTheDocument();
    expect(screen.getByText("41%")).toBeInTheDocument(); // disk usage
  });

  it("renders security control toggles reflecting seeded state", async () => {
    // srv-backup-04 has firewall disabled.
    await openDetail("srv-backup-04");

    expect(screen.getByText("Security Controls")).toBeInTheDocument();
    expect(screen.getByText("Firewall")).toBeInTheDocument();
    expect(screen.getByText("Encryption")).toBeInTheDocument();
    expect(screen.getByText("Antivirus")).toBeInTheDocument();
    expect(screen.getByText("Secure Boot")).toBeInTheDocument();
    expect(screen.getByText("TPM")).toBeInTheDocument();
    expect(screen.getByText("SSH enabled")).toBeInTheDocument();
    expect(screen.getByText("Auditd")).toBeInTheDocument();
    expect(screen.getByText("Passwordless sudo")).toBeInTheDocument();

    // Firewall toggle is disabled (unchecked) for this endpoint.
    expect(
      screen.getByRole("switch", { name: "Firewall disabled" }),
    ).toBeInTheDocument();
  });

  it("renders compliance findings with impact scores", async () => {
    await openDetail("srv-backup-04");

    expect(screen.getByText("Compliance Findings")).toBeInTheDocument();
    expect(screen.getByText("Firewall disabled")).toBeInTheDocument();
    expect(screen.getByText("31 pending security updates")).toBeInTheDocument();
    // Impact scores rendered as badges.
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("76")).toBeInTheDocument();
  });

  it("renders the updates section with pending count and password policy", async () => {
    await openDetail("srv-backup-04");

    expect(screen.getByText("Updates")).toBeInTheDocument();
    expect(screen.getByText("Pending updates")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(
      screen.getByText("Password policy (pass max days)"),
    ).toBeInTheDocument();
    expect(screen.getByText("90 days")).toBeInTheDocument();
  });

  it("renders the network section and audit history timeline", async () => {
    await openDetail("srv-web-01");

    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("IP address")).toBeInTheDocument();
    expect(screen.getByText("MAC address")).toBeInTheDocument();
    expect(screen.getByText("Connection uptime")).toBeInTheDocument();

    expect(screen.getByText("Related Reports")).toBeInTheDocument();
    expect(screen.getByText("Latest audit report")).toBeInTheDocument();
    expect(screen.queryByText("Previous audit")).not.toBeInTheDocument();
  });
});
