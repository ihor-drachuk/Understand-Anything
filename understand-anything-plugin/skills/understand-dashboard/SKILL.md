---
name: understand-dashboard
description: Launch the interactive web dashboard to visualize a codebase's knowledge graph
argument-hint: "[project-path]"
---

# /understand-dashboard

Start the Understand Anything dashboard to visualize the knowledge graph for the current project.

## Instructions

1. Determine the project directory and data directory:
   - If `$ARGUMENTS` contains a path, use that as the project directory
   - Otherwise, use the current working directory
   - Prefer the legacy `.understand-anything/` data directory when it exists, otherwise use `.ua/`

   Use the Bash tool to resolve:
   ```bash
   PROJECT_ARG="$ARGUMENTS"
   if [ -n "$PROJECT_ARG" ]; then
     PROJECT_DIR=$(cd "$PROJECT_ARG" 2>/dev/null && pwd -P)
   else
     PROJECT_DIR=$(pwd -P)
   fi

   if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
     echo "Error: Project directory not found: ${PROJECT_ARG:-$PWD}"
     exit 1
   fi

   if [ -d "$PROJECT_DIR/.understand-anything" ]; then
     UA_DIR="$PROJECT_DIR/.understand-anything"
   else
     UA_DIR="$PROJECT_DIR/.ua"
   fi
   ```

2. Check that `$UA_DIR/knowledge-graph.json` exists in the project directory. If not, tell the user:
   ```
   No knowledge graph found. Run /understand first to analyze this project.
   ```

   Use the Bash tool to check:
   ```bash
   if [ ! -f "$UA_DIR/knowledge-graph.json" ]; then
     echo "No knowledge graph found. Run /understand first to analyze this project."
     exit 1
   fi
   ```

3. Find the bundled viewer. This is a standalone bundle: the viewer and the built dashboard ship prebuilt under `packages/viewer/`, and nothing is downloaded, installed or built at runtime.

   Use the Bash tool to resolve:
   ```bash
   VIEWER="${CLAUDE_PLUGIN_ROOT}/packages/viewer/bin/viewer.mjs"
   if [ ! -f "$VIEWER" ] || [ ! -f "${CLAUDE_PLUGIN_ROOT}/packages/viewer/dist/index.html" ]; then
     echo "Error: the understand-anything bundle at '${CLAUDE_PLUGIN_ROOT}' has no prebuilt viewer."
     echo "Reinstall the standalone bundle instead of installing packages into the plugin directory."
     exit 1
   fi
   ```

4. Start the viewer:
   ```bash
   : "${VIEWER:?Run step 3 first so VIEWER is set}"
   : "${PROJECT_DIR:?Run step 1 first so PROJECT_DIR is set}"
   node "$VIEWER" "$PROJECT_DIR"
   ```
   Run this in the background so the user can continue working.

5. **Capture the access token URL from the server output.** The viewer prints a line like:
   ```
   🔑  Dashboard URL: http://127.0.0.1:<PORT>?token=<TOKEN>
   ```
   Extract the full URL including the `?token=` parameter. The token is required to access the knowledge graph data — without it the dashboard will show an "Access Token Required" gate.

6. Report to the user, including the full tokenized URL:
   ```
   Dashboard started at http://127.0.0.1:<PORT>?token=<TOKEN>
   Viewing: $UA_DIR/knowledge-graph.json

   The dashboard is running in the background. Press Ctrl+C in the terminal to stop it.
   ```
   **Important:** Always include the `?token=` parameter in the URL you share. If you omit it, the user will be blocked by the token gate and have to manually find the token in the terminal output.

## Notes

- The dashboard auto-opens in the default browser
- If port 5173 is already in use, the next available port is picked
