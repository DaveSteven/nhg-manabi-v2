import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Open the Select named `name` and pick the option named `option`. */
export async function chooseOption(user: UserEvent, name: string | RegExp,
                                   option: string | RegExp) {
  await user.click(screen.getByRole("combobox", { name }));
  const list = await screen.findByRole("listbox");
  await user.click(within(list).getByRole("option", { name: option }));
}
