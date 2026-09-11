import App from "@/App";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Renders the full application (router + layout + pages) and returns a
 * `navigateTo` helper that clicks a sidebar navigation link by label.
 */
export function renderApp() {
  const user = userEvent.setup();
  const utils = render(<App />);
  return {
    user,
    ...utils,
    async navigateTo(label: string) {
      const nav = await screen.findByRole("navigation", { name: "Primary" });
      await user.click(within(nav).getByRole("link", { name: label }));
    },
  };
}
