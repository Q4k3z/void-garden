# VOID GARDEN: Technical Report

40 source files and about 8,600 lines of JavaScript, GLSL, HTML and CSS. The only external
dependency is Three.js r160, loaded from a CDN. There are no texture, model or audio files:
even the PBR surface textures and the leaf-card atlas are generated on the GPU at load time.

## 1. Audit of the original prototype

The project started from a single-file prototype, `void_garden.html` (207 lines, not included
in this repository). What it did, and the problems found:

| Area | Finding |
| --- | --- |
| Rendering | Bare `import` of Three.js with no import map, so addons (post-processing) could not be loaded. No shadows, no post-processing, plain `FogExp2`. |
| Terrain | A 180 m `PlaneGeometry` with sin-hash value-noise fBm, roughly ±6 m of relief. The camera clamp (~60 m) sat near the plane's edge, and at 90 m the fog only reached about 80 %, so the world's edge was visible. It read as a gently rolling plane. |
| Determinism | Every placement used `Math.random()`, so the world changed on every load and had no seed. |
| Flora | 430 `Group`s of separate meshes, about 3,000 draw calls. The 18 "hero flowers" each built new geometries and carried their own `PointLight`, giving 21 dynamic point lights in every forward-shaded material. This was the main performance problem. |
| Grounding | Crystals, the halo and spores used absolute Y values instead of terrain-relative ones, so they floated or ended up buried. |
| Movement | No collision, no jump (Space was captured but did nothing), and a square clamp. Two `Vector3`s were allocated every frame. |
| Broken / incomplete | The hint "LOOK FOR THE GLOWING SEED" referred to a seed that did not exist. After the pointer lock was released and reacquired, the status and hint text never reset. `lang="vi"` on English content. |
| Kept | The brand, HUD style, intro card, the E "awaken" interaction with its toast text, R for return, the synthesized-audio approach and the cyan palette. All of these are preserved and extended. The glowing seed now exists and is the finale. |

## 2. Architecture

```
main.js ── World.generate() ─┬─ Heightfield   layout → analytic height → erosion → normals/AO/moisture
                             ├─ site selection + stamps (pads, cave notch)
                             ├─ Terrain (LOD chunks + backdrop) · Water
                             ├─ Ruins · Geology · Vegetation · Grass
                             └─ regions
        ├─ Sky + height-fog chunks + PMREM env · Lighting (moon, hemi, bio-light pool)
        ├─ Particles + Atmosphere (events, wind) · Life (creatures)
        ├─ Player · Game (interaction/discovery) · HUD · AudioEngine
        └─ Post (RenderPass → UnrealBloom → FinalPass)
```

Shared uniforms (`core/uniforms.js`) are referenced by every custom material: time, wind,
the resonance pulse, the player position, the garden glow level and the moon direction.
Each frame updates them once. Generation is deterministic: every system draws from its own
labelled RNG stream (`makeRng(seed, 'trees')`), so editing one system never changes the
random sequence of another.

## 3. Systems

### 3.1 Terrain (`heightfield.js`, `terrain.js`, `shaders/terrain.glsl.js`)

* **Macro layout (seeded).** The sector is 640 × 640 m. It contains a lake basin offset from
  the centre, a meandering canyon (a 22-segment polyline from the mountain wall down into the
  lake), two mesas, and an enclosing ring of mountains.
* **Analytic height function.** Built up in layers:
  * a domain warp (75 m amplitude) that bends every later layer;
  * broad fBm hills;
  * a six-octave **ridged multifractal**, masked into bands so mountain chains form instead of
    noise everywhere;
  * mid and fine fBm detail;
  * irregular partial **terracing**, which gives ledges and short cliff bands;
  * **mesas** with steep noise-distorted cliff rims and talus aprons;
  * a **U-shaped canyon** whose floor descends below the water table;
  * a **basin bowl** about 11–15 m below water.

  The boundary wall rises about 90–140 m. Beyond the sector the same function continues
  outward into 300–450 m ranges, out to 2.3 km.
* **Hydraulic erosion.** 190,000 simulated droplets (inertia, sediment capacity, a radius-3
  erosion brush, deposition, evaporation) carve gullies and deposit sediment fans. Erosion
  fades out near the sector edge so the heightfield meets the analytic backdrop without a seam.
* **Derived fields.** Normals come from central differences. Ambient occlusion is a horizon
  scan over 8 directions × 5 distances. **Moisture** is the droplet flow accumulation,
  log-normalised and combined with distance to the water. It drives the moss colour, the
  glowing mycelium veins and vegetation density.
* **Mesh.** 10 × 10 chunks of 64 m, each a `THREE.LOD` at 1 / 2 / 4 / 8 m spacing, with
  **skirts** that hide cracks between LOD levels. The triangulation matches `heightAt()`
  exactly, so collision is exact on the near LOD. A polar backdrop ring (384 × 64) carries
  the far ranges and discards its fragments inside the sector square.
* **Shading.** `MeshStandardMaterial` is patched with `onBeforeCompile`, so it keeps PBR
  lighting, shadows and fog. Albedo comes from slope, height, moisture and noise:
  * loam, turf and moss on the flats;
  * warped **rock strata** on slopes, faded with distance to prevent moiré;
  * ash on the peaks, sand at the shoreline;
  * wet darkening near water, and underwater absorption.

  Procedural micro-normals fade out with distance. AO is applied only to indirect light.
  Emissive mycelium veins follow the drainage network and flare as a resonance wave passes.

### 3.2 Sky, fog, environment (`sky.js`, `shaders/sky.glsl.js`)

* **Sky dome.** The haze gradient shares a GLSL function with the fog and the water
  reflections, so horizon colours match. It also has:
  * a moon disc with a faint 22° halo;
  * a ray-traced ice giant in crescent phase with a debris ring;
  * two star layers with twinkle, and a nebula band;
  * aurora curtains, and meteors during events.
* **Layered height fog.** It replaces Three.js's fog shader chunks for every material. It
  uses analytic exponential height fog (dense in valleys and over the lake, thin on the
  ridges), plus a small distance term that layers the far ranges into haze. Toward the moon
  the fog colour shifts to an in-scattering tint.
* **PMREM environment** built from the dome (without stars), for reflections and ambient
  specular.

### 3.3 Water (`water.js`, `shaders/water.glsl.js`)

* **Water table.** A global plane at y = 0. Water appears wherever the eroded terrain dips
  below it: the lake, the flooded lower canyon and natural hollows.
* **Depth.** The shader samples the **terrain height texture** to get true depth per pixel.
  That drives depth absorption (shallow turquoise to deep teal), alpha and shoreline effects.
* **Ripples.** Four scrolling noise-derivative octaves, plus expanding **ring ripples** on a
  hashed cell grid and shore-parallel wavelets.
* **Reflection approximation.** Sky-gradient reflection with Fresnel, darkened near the
  horizon to stand in for the reflected mountain line. A moon glitter path from three
  specular lobes.
* **Bioluminescence.** Shoreline glow, plankton sparkles, and a flare from the resonance
  wave.
* **Underwater.** Seen from below, the surface shows Snell's window. Diving switches the
  post pass to underwater absorption and haze, and the audio to a low-pass filter.

### 3.4 Lighting & post (`lights.js`, `post.js`, `shaders/post.glsl.js`)

* **Moon.** A low (22°) directional moon with PCF soft shadows (1024–4096 map) over a 150 m
  frustum that follows the camera, **snapped to shadow-map texels in light space** so it
  does not shimmer. A desaturated sky/ground hemisphere light provides fill.
* **Bio-light pool.** 2–8 `PointLight`s, re-assigned every 0.3 s to the nearest scored
  "glow spots" (flowers, crystals, ruins, the seed, the blinking pylon), cross-fading
  between assignments. The shader light count stays fixed, so lights follow the player with
  no recompiles. This replaces the prototype's 21 always-on lights.
* **Post chain.** A half-float MSAA render target with a depth texture, then
  `UnrealBloomPass` (threshold 0.92 in linear HDR, so only emissive surfaces bloom), then a
  final pass that applies:
  * **screen-space light shafts**: a depth-occlusion march toward the moon, weighted by
    each sample's distance to the moon so only sky near the moon emits;
  * underwater absorption;
  * ACES filmic tone mapping;
  * grading (teal shadows, warm highlights);
  * sRGB encoding, vignette, a subtle chromatic fringe and film grain.

  When post is off, the renderer tone-maps directly.

### 3.5 Vegetation (`geo.js`, `plants.js`, `vegetation.js`, `grass.js`, `materials.js`, `scatter.js`)

* **GeoBuilder.** Merges procedural primitives into one geometry with per-vertex colour,
  **glow** and **wind-sway weight**: parallel-transport tubes, displaced ellipsoids,
  two-sided cupped ribbons and pointed prisms.
* **Species.**
  * **Lantern Trees**, 10–27 m: curved trunks with buttress roots, branches ending in domed,
    rim-drooping caps with ribbed luminous gills, and **hanging tendrils** with glowing bulbs.
    Built from a shared "plan" so the near and far LODs keep the same silhouette. Tendrils
    are a separate layer that stays out of the shadow pass.
  * **Lumen Stalks** with bulb clusters.
  * **Lumen Blooms**, interactive, with an amber core and stamens.
  * Three **mushroom** forms: lantern caps, puffballs, needle caps.
  * **Coil Ferns** with serrated fronds and fiddleheads.
  * Succulent **bushes** with amber berries.
  * Shoreline **reeds**.
  * **GPU filament grass**.
* **Placement.** Jittered-grid sampling. Density is a product of slope, altitude, erosion
  moisture, baked AO, proximity to trees, a seeded grove centre and per-species **clumping
  noise**. The result is understories, shorelines and patches rather than a uniform
  sprinkle. Small plants partially align to the terrain normal and every object is sunk into
  the ground. Exclusion zones keep ruins, the cave mouth and paths clear. Quality only
  *thins* the decorative layers deterministically (per-instance hash), never moving them.
* **Bio material.** A patched `MeshStandardMaterial` adds:
  * world-coherent gusts in instance-local space (it works with rotated, scaled instances);
  * plants bending away from the player;
  * shimmering per-vertex emission;
  * resonance flares;
  * per-instance flare through `instanceColor`, used for the interactive blooms and crystals.
* **ScatterLayer.** Instances are split into 48–160 m cells, each an `InstancedMesh` with a
  tight bounding sphere. Three.js frustum-culls each cell, and each frame the cell picks a
  geometry LOD or hides by distance. Empty cells cost nothing.
* **Grass.** A fixed grid of instanced tufts (84²–144²) that follows the camera. Each
  instance maps to a world-anchored cell, so blades do not swim. The vertex shader reads
  height from the height texture (manual bilinear with `texelFetch`) and density from a baked
  mask. Blades are wind-swept, part around the player, and receive moon shadows.

### 3.6 Geology & storytelling (`rocks.js`, `ruins.js`, `world.js`)

* **Rock.** Boulders are noise-displaced, faceted ellipsoids with flattened bases, moss on
  their upper faces and glowing lichen specks. They sit in talus clusters at cliff feet and
  in the canyon. Large slabs are embedded in steep faces to give cliffs a real silhouette.
  There are pebble fields, hexagonal **basalt column** formations on the shores and canyon
  rims, **resonant crystal** deposits (cyan, violet and rare amber) favouring the seeded
  Shard Ridge, and two **natural arches**. Everything is grounded by sampling the minimum
  height under its footprint.
* **Landmarks.** Sites are chosen by deterministic searches with constraints (flatness,
  altitude, summit test, contour orientation, spacing), then terrain pads are flattened:
  * the **Listening Ring**: eleven weathered monoliths, two fallen outward and one broken,
    with glyph inlays and vines, an altar and a floating shard;
  * the **Sunken Gate**, half-drowned at the lake edge;
  * the **Orrery**: rotating rings around a burning core; its light beam can be triggered;
  * the **Signal Field**: bronze pylons, sagging cables and a still-blinking amber warning
    light;
  * the **Leviathan remains**: a 42 m spine, ribs with crystal growth, a half-buried skull;
  * six **echo stones**.
* **The Hollow (cave).** A heightfield cannot represent overhangs. So the cave is a **rock
  shell mesh buried in the hillside**, with a short notch carved into the terrain at the
  mouth, and collision handled by `World.groundAt()`, which returns the tunnel floor, walls
  and ceiling while the player is inside. Placement prefers the foot of mesa cliffs and falls
  back to a grid search, scoring candidates by rock cover above the tunnel and a level
  approach.

### 3.7 Creatures (`life/creatures.js`, `life/fauna2.js`)

All species share **IDLE → WANDER → DETECT → REACT → RETURN**. Detection radius scales with
the player's *noise*: still 0.3, crouching 0.42, walking 1.0, sprinting 1.75, plus wading
and landing.

| Species | Appearance | Movement | Reaction |
| --- | --- | --- | --- |
| **Lumen Drifter** (13) | Translucent lathe bell, glowing organ and rim lights, 8 additive tendrils waved in the vertex shader and trailing behind its velocity | Pulse-propulsion: impulses at bell contraction, drag, altitude keeping over terrain and water | Flashes and climbs away. Curious about resonance pulses: drifts toward them but keeps 9 m from the player. |
| **Skitterer** (4 herds × 5) | Segmented carapace with glowing dorsal spots and antennae | Procedural **tripod gait**: alternating leg groups, foot planting with step arcs, 2-bone **IK** with a pole vector, body tilted to the terrain normal; avoids water and cliffs | Freezes, then flees. **Panic spreads through the herd**, with clicking chirps. Wary of striders. Grazes at mushroom and fern beds. Legs are animated within 75 m and hidden beyond 150 m. |
| **Veil Strider** (4) | Pod body, glowing dorsal sail, belly tendrils, 7-segment neck, head with glowing eyes | Tripod legs stepping **one at a time**, 7–8 m tall, wades the shallows | Stops and **watches the player** (head tracking) from 26 m. Walks away if approached within about 12 m. Grazes with its head lowered. Deep FM calls. |
| **Glowmoth** (128) | Additive wing quads flapped in the vertex shader | Swarms orbiting bloom anchors | Scatters from the player. **Swarms migrate to awakened blooms.** |
| **Shy Tubes** (24 colonies) | Glowing tube worms near the shoreline | Sessile | Withdraw from footsteps (sooner if you are loud) and re-emerge one by one with staggered delays. |
| **Skyray** (3 flocks, 21) | Manta-like glider, 3.5 m span, two-sided wing membranes with glowing trailing edges, whip tail | **Boids** (cohesion to a moving flock goal, separation, terrain clearance). Wings **flap on the GPU**, harder when climbing and barely when gliding. Banks into turns. A flock sometimes skims the lake at 2 m. | Veers away from the visitor within 9 m and flares. Airy two-note calls. |
| **Glow-eel** (16) | Tapered eel with dorsal fin ribbon, two rows of luminous spots, amber eyes | Schools 0.45–1.3 m below the surface in water deeper than 1.8 m. **Travelling body wave on the GPU**, faster when fleeing. Occasional ballistic leaps clear of the water. | Darts away when the visitor wades or swims within 7 m. |
| **Mossback** (3 herds × 5) | Heavy quadruped: rounded rump and chest, moss ridge and glowing filaments on the spine and neck, pale belly, flank spots, horns and ear-fronds | Shared **quadruped rig**: phase-based gait with **walk** (lateral sequence), **trot** (diagonal pairs) and **gallop**, per-gait duty factor, stride and foot lift. 2-bone leg IK with knee and hock poles, body height and pitch from the feet and the terrain, bob and roll, neck and head look-at, lagging tail chain. | One head up while the herd **grazes** (neck lowered most of the time). The herd **detects** the visitor (noise-scaled) or a prowler, watches it, then **bolts together** at a gallop and returns home later. Bellowing calls. |
| **Shade Prowler** (2) | Lean, dark quadruped with violet rib stripes, long tail, flat head with fangs | Same rig, lighter and faster (8.5 m/s run) | **Predator.** PATROL → **STALK** (crouched, slow, toward the nearest skitterer) → **CHASE** (4.5 s burst) → **FEED** → **REST**. A kill takes a skitterer out of the herd for 90 s; the prowler is then sated for 100–170 s. A missed chase rests it and leaves that herd alone for 25–45 s. It watches the visitor and trots away within about 16 m. Rasping growls. |

**Predator–prey links.** Skitterers bolt from a hunting prowler (within 16 m of the one chasing
them, 9 m for herd-mates, 4.5 m for a stalking one) and run faster from it (6 m/s) than from the
visitor (4.2 m/s). Mossbacks treat prowlers as threats as well as the visitor. Over 10 minutes of
simulated time the two prowlers made 9 chases: 5 kills, 4 misses.

**Skin.** Skitterers, striders, mossbacks, prowlers, skyrays and eels use the bio material's
`VG_SKIN` path: a mottled pattern sampled triplanar in **object space** (so it moves with the
animal) from the rock height texture at two scales, dorsal countershading with a paler belly, a
wrap-around subsurface term on the terminator, and a cool rim sheen.

### 3.8 Gameplay (`player.js`, `game.js`, `ui/hud.js`)

* **Player.**
  * Acceleration-based movement, sprint, crouch-sneak, and jumping with coyote time and an
    input buffer.
  * **Slope limits**: climbing a face steeper than about 48° is blocked by removing the
    uphill component of motion; ground steeper than about 52° slides you down.
  * Wading slowdown, **swimming** (floating at the surface) and **diving**.
  * Circle colliders in a spatial hash (trees, boulders, ruins, crystals), cave wall and
    ceiling constraints, and a sector limit.
  * Camera: head bob tied to stride, footstep events per surface (moss, stone, water), strafe
    roll, a spring-based landing dip, a sprint FOV kick, and an idle breath.
* **Interaction.** View-cone focus over the static interactables and the live creatures,
  shown with a minimal prompt. **E** uses the focused object, or sends a **resonance pulse**
  when nothing is focused. The pulse is an expanding wave that flares flora, mycelium, water,
  grass and particles, and makes drifters curious. This keeps the prototype's "awaken"
  behaviour and its toast text.
* **Discovery.** Entering a named region records it ("DISCOVERED" title card). There is a
  four-category journal (places, flora, fauna, echoes) saved per seed, a compass with no
  markers, and a records counter.
* **Atmospheric events.** Every 75–140 s (or when triggered at a landmark): aurora surge,
  meteor shower, spore bloom, wind front, distant chorus. The wind veers and breathes
  continuously.

### 3.9 Audio (`audio/audio.js`)

Everything is synthesized with the Web Audio API:

* a **four-voice drone** whose chord and filter shift with each region;
* pink-noise **wind** responding to gusts, altitude and speed, plus a whistle layer up high;
* **positional shoreline water** that follows the nearest shore point;
* **HRTF-panned creature calls**: glassy drifter glides, skitterer click bursts, strider FM
  calls, and occasional distant reverberant calls;
* random nearby **biological sounds**: bubbling, trills, ticks;
* **footsteps** per surface, **interaction tones** (pentatonic blooms, inharmonic crystal
  partials, the signal pattern) and region swells;
* a generated-impulse **convolution reverb** that gets wetter in the cave, and a low-pass
  filter **underwater**.

### 3.10 Realism pass

A second pass aimed at a more physically convincing image. All of it is still procedural:
no image files are added.

* **Procedural PBR surfaces** (`render/texgen.js`). At load time the GPU renders three
  seamlessly tiling material sets: **rock**, **moss over soil**, and **rippled sand**. Each
  set has two textures: albedo with a height channel, and a normal map with roughness and
  cavity AO. The surfaces are built from periodic gradient noise, anisotropic bedding planes,
  sparse Voronoi fractures, sharp weathering creases, pits, mineral specks, moss clumps,
  pebbles and wind ripples. Normals and cavity come from a separate half-float height pass,
  so normals have no 8-bit banding. Generation takes about 0.4–0.6 s at 1024²; Low uses 512²
  and Ultra 2048².
* **Terrain shading** (`shaders/terrain.glsl.js`):
  * **triplanar rock**, so cliffs never stretch;
  * two scales combined as a *detail overlay* rather than an average, which keeps contrast
    without visible tiling;
  * two-scale rotated ground sampling;
  * **height-based layer blending**: moss fills rock crevices, sand settles between pebbles;
  * UDN normal blending, texture roughness and cavity AO;
  * texture detail fading into a macro colour beyond about 260 m.
* **Textured objects.** Boulders, cliff slabs, ruins, the cave shell, bones, pylons and tree
  bark use the same triplanar rock set in the shared bio material, at per-material scale and
  strength, so props and terrain read as the same geology.
* **Baked long-range moon shadows** (`Heightfield.bakeSunShadow`). For every 1.5 m sample a
  ray is marched toward the moon, storing the *shadow-plane height*
  `S = max(H(t) − t·tan(elevation))`. Any point at that xz whose height is above S sees the
  moon. One half-float texture therefore shadows terrain, plants, tree crowns, creatures and
  the water's glitter at any distance, so mountains throw shadows across whole valleys far
  beyond the 150 m shadow map. Penumbrae widen with distance to the occluder. The texture is
  applied by patching the directional-light term of every lit material (`patchSunShadow`).
  Bake time is about 0.16 s.
* **Planar lake reflections** (High and Ultra). The water uses a mirrored camera with oblique
  near-plane clipping (Three's `Reflector`) that renders only a lean "reflectable" layer:
  terrain, sky, lantern-tree bodies, ruins, crystals, basalt, arches, drifter bells and
  strider bodies. Lights are put on the same layer so the mirrored pass shares shader
  programs. The image is distorted by the ripple normals. The ripple strength follows the
  wind, so the lake is mirror-calm between gusts.
* **SSAO.** Half-resolution, depth-only, edge-aware normal reconstruction, golden-angle
  sampling with interleaved gradient noise. It is upsampled through a depth-aware 3×3 filter
  and applied before tone mapping, with emissive surfaces protected.
* **Leaf translucency.** Moonlight scatters through thin geometry (leaves, petals, sails,
  grass) when backlit. It is weighted by each vertex's flexibility and masked by the terrain
  shadow.
* **Eye adaptation.** Exposure adapts slowly: it opens in the cave (×1.9), underwater, and in
  the shadow of mountains, and closes quickly when you step back into moonlight.
* **Night sky.** A galactic band of denser stars, unresolved glow and a dark dust rift; a
  smaller, crisper moon glow; a much fainter ice halo.
* **Cave opening fix.** The terrain discards its fragments inside the tunnel volume, so steep
  hillsides can no longer wall off the cave mouth. A faint glow spills from the entrance.

### 3.11 Foliage pass (leaf cards)

Plants were the most stylised element, so they were rebuilt around textured leaf cards.

* **Procedural foliage atlas** (`render/foliagegen.js`). A 4×2 atlas (2048×1024 on
  Medium and up; 1024×512 on Low) is drawn on the GPU at load time. Each design is an
  alpha-cut shape with albedo, a normal map from its relief, and a thickness channel used for
  translucency:
  * a pinnate **fern frond**: 22 alternate, curved, tapering pinnae with lobed edges on a
    rachis;
  * a **broad leaf** with a serrated rim, midrib, lateral and fine veins;
  * a **petal** with radial veins;
  * a **grass clump** of 11 curved blades, some of them dry;
  * a **strap leaf** with parallel ribs, used for reeds;
  * a **small-leaf cluster** with twigs, used for bushes;
  * hanging **moss strands**;
  * a solid neutral cell, which lets non-leaf geometry share the same material.
* **Geometry.** `GeoBuilder` now carries atlas UVs. Ribbons map their width and length onto a
  cell (inset so mip levels never bleed between cells). Ferns are arched frond cards, stalk
  leaves and basal leaves are broad-leaf cards, flowers have petal cards, and reeds are strap
  cards. **Bushes** went from lumpy spheres to 24–32 leaf-cluster cards spread over a dome
  around a dark woody core, with 9–12 larger cards on the far LOD.
* **Grass.** Each GPU tuft is now three crossed clump cards, about 30 visible blades instead
  of 4 modelled strips, with fewer vertices than before.
* **Material** (bio material `VG_FOLIAGE`, and grass):
  * an alpha-cut shape with **alpha-to-coverage** on MSAA presets, giving smooth leaf edges
    without sorting;
  * **coverage boosted with the mip level**, so distant foliage keeps its density instead of
    dissolving;
  * a leaf normal map applied through a screen-space-derivative tangent frame (no tangent
    attribute needed);
  * a per-pixel thickness that drives translucency, with transmitted light taking on the
    leaf's hue;
  * grass specular damped, because up-biased normals made backlit blades read as silver.
* **Cost.** About +0.2–0.3 ms GPU at 1080p on High (3.9–4.4 ms versus 3.6–4.2 ms). Atlas
  generation is part of the 2.2 s load.

### 3.12 Ecosystem pass (biomes, new flora and fauna)

The world was mostly lantern trees and understory, and the animals were few and stiff. This
pass adds regions with their own plant life, fauna in the sky, in the water and on open ground,
a predator, and better creature shading.

* **Biome map** (`Vegetation.biome`, exposed as `world.biomeAt`). Two large-scale noise fields
  are biased by the terrain:
  * dry, high ground becomes **Amber Heights**;
  * damp hollows become the **Violet Wood**;
  * open mid-ground becomes the **Coral Thicket**;
  * water margins stay wetland, and the Lantern Grove keeps its own area.

  Coverage of the play area for `LYRA-09`: amber 23 %, fungal 18 %, coral 10 %, wetland 10 %,
  grove 5 %, and the rest is the original thicket. Each biome is a named region with its own
  ambient drone chord and a journal entry. A biome's entry exists only if it covers more than
  1.5 % of the map.
* **New flora** (`world/plants2.js`):
  * **coral trees**: recursive three-way branching with polyp crowns, in rose, ember and dusk
    colour forms;
  * **parasol fungi**: 4.5–8.5 m tall, with a hanging skirt, a warty cap, radial luminous
    gills, and smaller parasols at the foot;
  * **spire horns**: clusters of twisted, ridged mineral spikes with amber growth bands;
  * **thornbrush**: wiry twigs with pale thorns and glowing berries;
  * **lily pads with lantern lilies**: notched two-sided pads placed at the water level, some
    with closed luminous buds;
  * **kelp**: swaying strap blades with glowing float bladders, 1.1–4.5 m deep.

  The large species have colliders and two LODs, and some feed the bio-light pool with pink,
  violet or amber light.
* **Existing flora reacts to biomes.** Lantern trees thin out outside the grove in the new
  biomes, ferns, stalks and bushes give way on the amber heights, and mushroom clusters
  multiply in the Violet Wood.
* **Grass tint.** The grass density texture is now RGBA: R is density, G is dryness, B is
  fungal. Blades turn dry gold on the heights and dusky violet in the fungal wood, and grow
  sparser on dry ground.
* **Fauna and shading.** See 3.7: skyrays, glow-eels, mossbacks and shade prowlers, the
  predator–prey links, and the `VG_SKIN`, `VG_FLAP` and `VG_SWIM` material paths. Flapping and
  swimming are vertex-shader deformations driven by an `aSway` parameter (signed wing span, or
  position along the body) and a per-instance effort value, so each flock or school is a
  single instanced draw.
* **Journal.** It now has 40 entries for the default seed (was 28):
  * three places (Violet Wood, Coral Thicket, Amber Heights);
  * five flora (coral tree, parasol fungus, spire horn, thornbrush, lantern lily), recorded
    by walking close to them;
  * four fauna (skyray, glow-eel, mossback, shade prowler), recorded by observing them with
    **E** or when they react near you.
* **Cost**, measured as an interleaved A/B test (new content shown or hidden on alternate
  frames, 30 pairs, 1920×1080 render target, High): +0.32 ms at the landing site, +0.46 ms in
  the Violet Wood, +1.01 ms in the Coral Thicket, +1.29 ms on the Amber Heights, +0.21 ms in
  the grove and 0.00 ms over the lake. A first version cost +2.3 ms in the Coral Thicket. It
  was brought down by:
  * a plain material instead of triplanar texturing for the coral trees and spire horns;
  * fewer branch segments;
  * a closer near-LOD distance for the coral trees, spire horns and parasol fungi.

  Creature simulation for every species together measured 0.17 ms per update step.

### 3.13 Input and stability fixes

* **Camera jumps when turning or looking up.** The main cause was shaders compiled in the
  middle of play. `compileAsync` builds programs for the default framebuffer, but the scene is
  drawn into offscreen targets, so the real programs were built the first time an object came
  into view. Turning 45° at the landing site compiled two programs and stalled one frame for
  96 ms; the mouse input of that stall arrived all at once.

  The loader now renders one warm-up frame through the real pipeline: offscreen targets,
  shadow pass and lake mirror, with every object visible and unculled and every instanced mesh
  drawn once. The frame adds about 23 ms to loading. It runs on the first visible frame if the
  page loaded hidden.
* **Adaptive resolution.** A view costs about 3× less looking at the sky than at the ground
  (1.45 ms against 4.47 ms at the landing site). The old controller decided from the last
  ~0.15 s, so glancing up could trigger a render-target resize, a visible hitch, and looking
  down another. It now:
  * uses the 90th percentile of a 2 s window;
  * scales up only after two cheap windows in a row, and only if the predicted cost at the
    new scale stays in budget;
  * never scales up within 8 s of a downscale;
  * scales down in proportion to the overshoot.
* **Mouse input.**
  * Pointer lock requests raw movement (`unadjustedMovement`) where supported, which avoids
    OS acceleration and Chrome's spurious large deltas.
  * The first two deltas after the lock engages are ignored.
  * An isolated outlier (over 180 px and over 6× the previous event) is dropped. A real flick
    ramps up over several events and passes.
* **Pointer lock recovery.** A refused lock request (resuming with Esc is not a user gesture,
  and re-locking right after Esc is refused) used to switch the game to drag-to-look
  permanently. Now the game shows "click the view to capture the cursor" and drag-to-look
  works until the next click locks again. Esc also pauses when the cursor is not locked, which
  was impossible in `?nolock` mode.
* **Region flicker.** Walking along a region border made the region card, the chime and the
  ambient chord flip back and forth. A new region must now hold for 1 s.
* **Audio** resumes on the first click or key press. With `?autostart` it used to stay silent.
* **Bright squares in the sky.** Distant skyrays (and, more rarely, other small glowing parts)
  showed up as soft, glowing squares. With MSAA, a pixel only partly covered by a sub-pixel
  triangle (an eye, a berry, a wing edge) is shaded at the pixel centre, outside the
  triangle. There the per-vertex glow and colour extrapolate far out of range: HDR values of
  49–257 were measured where about 1.5 is normal. The bloom mip chain then spread each of
  those pixels into a square. The fix clamps the glow, colour and per-instance varyings in the
  bio material, the grass blade and tint varyings, and the drifter tendril fade. After it, the
  same views peaked at about 2.0, apart from the water's intentional moon glints (5–13).
* **World fixes.**
  * The visitor no longer walks through mossbacks and prowlers.
  * Herd-mates keep a body length apart.
  * Skyrays have a hard floor 1 m above the ground or water.
  * Eels only leap where they will land in deep water.
  * Kelp is scaled to stay 0.3 m under the surface.
  * Lily-pad clusters are only placed where the whole cluster is over water.
  * The colliders of the parasol fungi (0.7 m) and spire-horn clusters (0.85 m) now match
    their footprint.

## 4. Performance engineering

* Instancing everywhere, with **cell-based frustum culling and LOD** (`ScatterLayer`), terrain
  LOD chunks, and tendrils excluded from the shadow pass.
* A fixed-size **bio-light pool** instead of per-object lights.
* GPU-side grass and particles: no per-frame CPU work, no buffer uploads.
* The per-frame update loop is allocation-free in the hot paths: shared scratch vectors, and
  persistent observable objects for focus testing.
* **Adaptive resolution** driven by **GPU timer queries**, so it is immune to vsync caps and
  background-tab throttling.
* **Generation yields** use `setTimeout` rather than `requestAnimationFrame`, which is
  throttled in background tabs. This cut load time from 21 s to about 2–3 s in testing.
* Shader warm-up (`compileAsync`) and first frames rendered behind the loading screen.
* Disposal: the PMREM generator, environment capture geometry and post render targets are
  disposed when rebuilt. Changing seed or density presets reloads the page, which releases
  all GPU memory.
* Development optimisation pass: High went from **6.3 M to 1.3–1.6 M triangles** at the
  spawn view by slimming plant geometry, splitting tree tendrils into their own layer and
  tightening LOD distances.

## 5. Testing evidence

All tests ran in a Chromium-based browser (Chrome 156, NVIDIA RTX 3070 Ti,
Windows 11). Logic tests used a fixed-step harness that calls the real `Player`, `Game` and
`Life` updates at 60 Hz.

| Test | Result |
| --- | --- |
| Load and boot with no console errors or warnings (High, Ultra, Low, two seeds) | Pass. The console was clean after fixing a 0×0-canvas framebuffer warning (canvas size is now checked every frame). |
| World generation time | 1.7–3.4 s, varying with background throttling of the pane |
| Determinism | Two full generations of `LYRA-09` gave **identical** fingerprints: heightfield hash, site positions, vegetation counts, tree positions, crystals, colliders. `ORPHEUS-3` differed in every field. |
| Bloom interaction | Focus = `bloom`, then awakened, flare 1.8, journal entry recorded |
| Resonance pulse (nothing focused) | Pulse strength 1.02 with radius growing; the `mycelium` journal entry recorded |
| Skitterer behaviour | WANDER → DETECT at 7.5 m → REACT; herd-mates switched to REACT/RETURN; later RETURN → IDLE → WANDER cycles |
| Drifter behaviour | WANDER → IDLE → DETECT at 10.6 m → REACT → RETURN → IDLE → WANDER |
| Strider behaviour | WANDER → DETECT at 26 m (watching) → REACT when close → IDLE → WANDER. Planted feet sit exactly on the terrain (0.00 m gap); stepping feet are lifted 0.5–0.8 m. |
| IK sanity | 0 NaN matrices across all skitterer and strider leg segments after 45 s of simulation |
| Tree collision | The player stops at trunk radius + 0.38 m (e.g. 1.21 m for a 0.83 m trunk), or slides around it |
| Cliff blocking | Walking up a face for 6 s: rose 4.5 m and stopped below a cliff top 9.7 m higher |
| Swimming / diving | Float with eye at +0.29 m; diving takes the eye to −3.5 m (underwater state on); resurfaces on release |
| Jump | 0.94 m apex, landed |
| Cave | Walking in reaches the end-wall limit; side limit follows the taper; ceiling clamps the jump; the region "THE HOLLOW" is recorded |
| UI | Journal (28 entries, tabs, persistence), pause menu, and settings. Live toggles of bloom, light shafts and shadows rebuild without errors. |
| Benchmark mode | `?bench=2` completed and produced the result object and toast |
| Ecosystem pass: boot | Loads with no console errors. Journal has 40 entries for `LYRA-09`. |
| Ecosystem pass: determinism | Two loads of `LYRA-09` gave identical fingerprints: biome flora positions and counts, all 33 scatter-layer counts, herd and den positions, biome coverage. |
| Quadruped rig | 0 NaN values in all new instance matrices after 60 s of simulation. Planted feet sat 0.000 m from the terrain over 6,190 samples. This followed a fix: a foot could hang 13 cm in the air when the animal stopped mid-stride. A mossback reached a 7.0 m/s gallop 1.5 s after a scare. |
| Predator–prey balance | First version: 28 chases and 28 kills in 5 simulated minutes, which would empty the herds. After adding satiety, chase limits and faster prey flight: 9 chases, 5 kills and 4 misses in 10 minutes. Dens are placed next to the skitterer herds. In the first build they were 120 m away and never found prey. |
| Mid-game shader compiles | Before: turning 45° at the landing site compiled 2 programs, with a 96 ms frame. After the warm-up: 60 views (6 places, 8 directions, up and down, including underwater) plus aurora and meteor events compiled **0** new programs. The slowest frame was 7.2 ms. Visibility and LOD were restored correctly: 802 draw calls at the landing site, and no scatter cell with two LODs visible. |
| Mouse filter (synthetic events) | Normal moves fully applied. A single 900 px spike was dropped. A 20→320 px flick ramp was fully applied. Pitch clamps at 1.45 rad. No look without lock or drag. |
| Pointer lock, Esc, regions, collision | Esc pauses and resumes in drag-look mode. Crossing a region border every 0.5 s for 5 s changed the region 0 times; staying 1.5 s on the other side changed it. A visitor placed inside a mossback was pushed out to 1.23 m (body radius 1.09 m). The console stayed clean. |
| New species visuals | Rendered from several viewpoints: herd side view, gallop, rear view, skyray flock from above and below, eel from above and at its own depth, the three biomes at eye level, close-ups of each plant. These caught and fixed several problems: inverted skyray wing lighting, an open body tube at the mossback's rump, table-leg limbs (now tapered with muscle bulges), and over-bright eel fins and parasol gills. |

**GPU cost** (timer queries, 1920×1080 render target, median of 30 back-to-back frames after
warm-up):

| View | High | Ultra (1.0×) |
| --- | --- | --- |
| Landing site toward the moon | 2.15 ms · 297 draws · 1.56 M tris | 2.40 ms · 335 draws · 2.24 M tris |
| Inside the Lantern Grove | 3.82 ms · 567 draws · 2.70 M tris | 2.90 ms · 593 draws · 3.27 M tris |
| Listening Ring | 2.70 ms · 349 draws · 1.48 M tris | 2.64 ms · 373 draws · 1.97 M tris |
| Mesa vista over the basin | 2.81 ms · 645 draws · 1.80 M tris | 2.95 ms · 672 draws · 2.36 M tris |

CPU render submission was 1.3–2.9 ms per frame; game logic was about 1–2 ms.

**After the realism pass** (same method, High, 1920×1080 render target):

| View | GPU | CPU submission | Draw calls | Triangles |
| --- | --- | --- | --- | --- |
| Landing site over the lake (mirror pass active) | 3.60 ms | 3.14 ms | 692 | 1.98 M |
| Inside the Lantern Grove | 4.03 ms | 3.20 ms | 716 | 3.25 M |
| Listening Ring | 3.85 ms | 2.13 ms | 400 | 1.72 M |
| Mesa vista over the basin | 4.17 ms | 3.53 ms | 845 | 2.22 M |

**After the foliage pass** (same method): GPU 3.89 / 4.41 / 4.14 / 4.35 ms for the four views
above · 698 / 716 / 406 / 845 draw calls · 1.89 / 3.16 / 1.61 / 2.12 M triangles.

**After the ecosystem pass** (High, 1920×1080 render target). The cost is reported as an
interleaved A/B test, new content on and off in alternate frames, because absolute timer
readings in this session were inflated by the GPU's clock state. In the same run the views
measured 5.3–7.8 ms with the new content and 5.1–6.8 ms without it. Earlier sessions measured
3.9–4.4 ms for the old content alone.

| View | With new content | Without | Added | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| Landing site over the lake | 5.37 ms | 5.05 ms | +0.32 ms | 818 | 2.19 M |
| Violet Wood | 6.22 ms | 5.76 ms | +0.46 ms | 773 | 2.50 M |
| Coral Thicket | 7.75 ms | 6.75 ms | +1.01 ms | 1,008 | 2.75 M |
| Amber Heights | 6.81 ms | 5.52 ms | +1.29 ms | 1,011 | 2.72 M |
| Lantern Grove | 6.20 ms | 5.99 ms | +0.21 ms | 900 | 3.48 M |
| Lake shore | 5.28 ms | 5.29 ms | 0.00 ms | 649 | 2.51 M |

The on-screen FPS benchmark was **not** re-run after this pass. The browser pane was being
throttled while it was in the background (about 3 rendered frames per second), so FPS and
load-time numbers from it would be meaningless. Run `?bench=30` in a normal browser tab to
measure.

**On-screen FPS** (visible tab, 120 Hz display, adaptive resolution off; before the ecosystem pass):

| Run | Result |
| --- | --- |
| `?bench=20`, High, 1297×723 canvas, fly-through of every landmark (after the foliage pass) | **119.6 FPS average, 99 FPS 1 % low**, 2,383 frames · GPU median 5.5 ms, p99 7.2 ms · CPU 3.1 ms |
| Same run before the foliage pass | 119.4 FPS average, 108.7 FPS 1 % low · GPU median 5.6 ms, p99 7.8 ms |
| Live, High, 1297×723 | 120 FPS (display cap) |
| Live, Low, 1102×614 | 119.7 FPS (display cap) |

Numbers are capped by the display refresh. At a full 1920×1080 window on this GPU, the
GPU cost above (about 4 ms) leaves large headroom for 60 FPS. For a mid-range GPU (about
one third of this throughput) the expected cost is roughly 11–14 ms on High at 1080p. That
is an **estimate, not a measurement**; adaptive resolution covers the gap, and Medium drops
the mirror pass.

## 6. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Convincing terrain elevation and geological depth | Done. About 160 m of relief inside the sector, plus far ranges up to about 450 m, from ridged multifractals, mesas with cliff rims, a canyon, a sub-water basin, terraces and erosion. |
| Not a flat plane with decorations | Done. Verified from ground level, from the mesa rim and from an elevated view on two seeds. |
| Believable distant silhouette | Done. An enclosing mountain wall plus layered backdrop ranges in height and distance haze. |
| Vegetation follows the terrain | Done. Slope, moisture and altitude rules, normal alignment, sunk bases; grass reads the height texture. |
| Lighting creates depth | Done. Low moon with shadows, height fog, hemisphere fill, bio-light pool, light shafts, bloom, grading. |
| Water and atmosphere integrated | Done. Depth-aware water with shoreline glow, matched fog and sky, particles, events. |
| At least 3 creatures with movement and behaviour | Done. Nine species across air, water and land, including a predator that hunts the skitterers. State machines for skitterers, drifters, striders, mossbacks and prowlers were verified in tests. |
| Free exploration | Done. About 520 m explorable sector with walking, sprint, jump, swim, dive and the cave. |
| Interactive objects work | Done. Blooms, crystals (with chains), altar, orrery, console, skull, echo stones, the seed, creature observation. |
| Deterministic by seed | Done. Verified identical fingerprints. |
| No critical console errors | Done. The console was clean in the final runs. |
| Performance measured, quality settings provided | Done. On-screen benchmark before the ecosystem pass (119.6 FPS average, 99 FPS 1 % low on High at 1297×723, capped by the 120 Hz display), GPU timer-query costs at 1080p including an A/B measurement of the ecosystem pass, four presets, live settings and adaptive resolution. Not measured: FPS after the ecosystem pass, and FPS on a mid-range GPU. |
| Playable with the documented instructions | Done. `python serve.py`, see README. |

## 7. Known limitations

* **Wind and shadows.** Wind sway is not applied in the shadow pass, so foliage shadows are
  static. The motion is small enough that this is rarely noticeable.
* **Light shafts** are screen-space and fade out when the moon leaves the screen.
* **Water reflections.** High and Ultra mirror a reduced object set (no grass, small plants,
  boulders, tendrils or particles). Low and Medium fall back to the analytic sky and horizon
  approximation. The mirror pass adds about 250–380 draw calls.
* **Foliage.** Leaves are procedural leaf cards, not scanned assets. Up close, the large
  lantern-tree caps and the mushrooms are still smooth modelled shapes. Grass grows in visible
  clumps rather than a continuous lawn. On Low (no MSAA) leaf edges are alpha-tested and can
  shimmer in motion. In the 1 % low of the High benchmark (99 FPS against 108.7 before) the
  GPU p99 actually improved, so the drop is most likely CPU/GC noise during the fly-through.
  This was not investigated further.
* **Texture swim.** Triplanar textures on wind-animated tree parts slide very slightly as
  they sway.
* **No real-time global illumination or volumetric fog.** Bounce light is approximated by the
  hemisphere fill, the environment map and the bio-light pool.
* **One cave per world.** Overhangs elsewhere are not possible with a heightfield.
* **Collision** uses 2D circles. You cannot stand on top of boulders or ruins. Creatures use
  local steering, not path-finding, and drifters can brush through tree canopies.
* **GPU grass** receives shadows but does not cast them.
* **Desktop first.** No touch controls. Mobile browsers are not a target.
* **Raw mouse input** (where the browser supports it) bypasses OS pointer acceleration, so
  mouse speed can feel different from the desktop cursor. Adjust it with the sensitivity
  slider.
* **Not exercised under load:** the new adaptive-resolution controller was reviewed and runs
  without errors, but no test machine was slow enough to make it change scale.
  Real pointer lock cannot be engaged by the automated test pane, so the lock path was
  exercised with synthetic events through the drag-look path, which shares the same filter.
* **Audio** starts on the Enter click (browser autoplay policy). With `?autostart` the audio
  context may stay suspended until the first click.
* **Online dependency.** Three.js is loaded from a CDN. For offline use, vendor it (README).
* **Draw calls.** Dense views now reach about 1,000 draw calls on High, after the ecosystem
  pass added more scatter layers. This is fine on desktop, but it is the main CPU cost on
  low-end machines, where the Low preset helps.
* **Creature animation.**
  * The quadruped rig has a rigid torso, without spine flex or breathing deformation beyond a
    slight scale.
  * Limbs are tapered segments without separate feet.
  * Gait transitions blend speed but switch phase offsets abruptly.
  * Skyrays do not avoid tall trees; they fly well above most of them.
  * Eels stay inside the lake basin but do not avoid each other.
* **Predator–prey** is local and simplified. Prowlers only hunt skitterers, and chases use
  straight steering with no path-finding. A caught skitterer simply disappears and a
  replacement wanders back to the herd 90 s later; there is no carcass.
* **Biome flora** is modelled geometry, not leaf cards, so the coral trees and parasol fungi
  look smooth up close.
