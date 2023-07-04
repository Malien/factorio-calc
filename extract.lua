local json = require "lunajson"

local path_to_factorio = arg[1]

if not path_to_factorio then
  print("Usage: lua extract.lua <path_to_factorio>")
  os.exit(1)
end

function escape_path(str)
  return str:gsub(" ", "\\ ")
end

local function must(res, err)
  if err then
    print(err)
    os.exit(1)
  end
  return res
end

function extract_recipe(output_filename)
  data = {}
  function data:extend(obj)
    for k, v in pairs(obj) do
      self[k] = v
    end
  end

  dofile(path_to_factorio .. "/data/base/prototypes/recipe.lua")
  os.execute("mkdir -p extracted")
  local file = must(io.open("extracted/" .. output_filename, "w"))
  must(file:write(json.encode(data)))
  must(file:close())
  data = nil
end

function lines(str)
  local pos = 1
  local next
  return function()
    next = string.find(str, "\n", pos, true)
    if not next then return nil end
    local line = string.sub(str, pos, next - 1)
    pos = next + 1
    return line
  end
end

function parse_cfg(contents)
  local result = {}
  local scope = nil
  for line in lines(contents) do
    if line:match("^%[") then
      scope = line:match("^%[(.*)%]$")
      result[scope] = {}
    else
      local key, value = line:match("^([^=]*)=(.*)$")
      if key and value then
        result[scope][key] = value
      end
    end
  end
  return result
end

function extract_locale(locale)
  local file = must(io.open(path_to_factorio .. "/data/base/locale/" .. locale .. "/base.cfg"))
  local contents = must(file:read("*a"))
  local cfg = parse_cfg(contents)
  must(file:close())

  local output_file = must(io.open("extracted/locales/" .. locale .. ".json", "w"))
  must(output_file:write(json.encode {
    item = cfg["item-name"],
    fluid = cfg["fluid-name"],
    recipe = cfg["recipe-name"],
    entity = cfg["entity-name"],
    equipment = cfg["equipment-name"],
  }))
  must(output_file:close())
end

os.execute "mkdir -p extracted/locales"

function extract_graphics(category)
  local src_path = escape_path(path_to_factorio) .. "/data/base/graphics/" .. category .. "/"
  local dst_path = "extracted/graphics/" .. category .. "/"
  os.execute("mkdir -p " .. dst_path)
  os.execute("cp -r " .. src_path .. " " .. dst_path)
end

extract_recipe "recipe.json"
extract_locale "en"
extract_graphics "icons"

