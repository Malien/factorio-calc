vim.api.nvim_create_user_command("Dev", function()
  local current_tab = vim.api.nvim_get_current_tabpage()
  vim.cmd ":tabnew | terminal pnpm run dev --host"
  vim.api.nvim_buf_set_name(0, "dev server")
  vim.api.nvim_set_current_tabpage(current_tab)
  print "Started dev server in a new tab"
end, { nargs = 0, desc = "Start a dev server in a new terminal tab" })
