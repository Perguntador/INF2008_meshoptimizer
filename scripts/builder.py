import bpy
import numpy as np
import os
import time
import sys
from datetime import datetime

# --- Configurações ---
INPUT_FILE = "./assets/lucy.ply"
INTERMEDIATE_FILE = "./assets/lucy.glb"
OUTPUT_FILE = "./assets/lucy.chunked.glb"
EXPORT_INTERMEDIATE = True

LIMIT_VERTS = 65000 

def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")
    sys.stdout.flush()

def cleanup_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in bpy.data.meshes:
        if block.users == 0: bpy.data.meshes.remove(block)

def strip_mesh_data(obj):
    """
    Remove dados desnecessários (Cores, Atributos) para reduzir o tamanho do arquivo.
    Equivalente manual ao antigo export_colors=False.
    """
    mesh = obj.data
    
    # Remove todos os atributos de cor (Color Attributes)
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])

    # Opcional: Remover UVs se não precisar (descomente se a malha não tiver textura)
    # while mesh.uv_layers:
    #     mesh.uv_layers.remove(mesh.uv_layers[0])
        
    # Opcional: Remover atributos genéricos (ex: peso de vertex groups, etc)
    for attr in mesh.attributes:
        if attr.name not in ['position', 'index', 'normal', 'uv']: # Mantém o básico
            try:
                mesh.attributes.remove(attr)
            except:
                pass

def import_source_mesh(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.ply':
        if hasattr(bpy.ops.wm, "ply_import"):
             bpy.ops.wm.ply_import(filepath=filepath)
        else:
             bpy.ops.import_mesh.ply(filepath=filepath)
    elif ext in ['.glb', '.gltf']:
        bpy.ops.import_scene.gltf(filepath=filepath)
    elif ext == '.obj':
        bpy.ops.import_scene.obj(filepath=filepath)
    
    mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    return mesh_objs[0]

# --- FUNÇÕES NUMPY (Intocadas) ---
def get_mesh_data_numpy(mesh_obj):
    mesh = mesh_obj.data
    mesh.calc_loop_triangles()
    n_verts = len(mesh.vertices)
    n_faces = len(mesh.loop_triangles)
    verts = np.empty(n_verts * 3, dtype=np.float32)
    normals = np.empty(n_verts * 3, dtype=np.float32)
    faces = np.empty(n_faces * 3, dtype=np.int32)
    mesh.vertices.foreach_get("co", verts)
    mesh.vertices.foreach_get("normal", normals)
    mesh.loop_triangles.foreach_get("vertices", faces)
    verts.shape = (n_verts, 3)
    normals.shape = (n_verts, 3)
    faces.shape = (n_faces, 3)
    v_coords = verts[faces] 
    centers = np.mean(v_coords, axis=1)
    return verts, faces, centers, normals

def recursive_split(face_indices, all_verts, all_faces, all_centers, axis=0, depth=0):
    current_faces = all_faces[face_indices]
    unique_verts = np.unique(current_faces)
    if len(unique_verts) <= LIMIT_VERTS:
        return [face_indices]
    current_centers = all_centers[face_indices]
    median = np.median(current_centers[:, axis])
    mask_right = current_centers[:, axis] > median
    mask_left = ~mask_right
    indices_right = face_indices[mask_right]
    indices_left = face_indices[mask_left]
    if len(indices_right) == 0 or len(indices_left) == 0:
        mid = len(face_indices) // 2
        indices_left = face_indices[:mid]
        indices_right = face_indices[mid:]
    next_axis = (axis + 1) % 3
    chunks = []
    chunks.extend(recursive_split(indices_left, all_verts, all_faces, all_centers, next_axis, depth+1))
    chunks.extend(recursive_split(indices_right, all_verts, all_faces, all_centers, next_axis, depth+1))
    return chunks

def create_mesh_from_indices(name, all_verts, all_normals, all_faces, subset_face_indices):
    chunk_faces_global = all_faces[subset_face_indices]
    unique_v_ids, inverse_indices = np.unique(chunk_faces_global, return_inverse=True)
    new_verts = all_verts[unique_v_ids]
    new_normals = all_normals[unique_v_ids] 
    new_faces = inverse_indices.reshape(chunk_faces_global.shape)
    n_loops = len(new_faces) * 3
    n_polys = len(new_faces)
    mesh = bpy.data.meshes.new(name=name)
    mesh.vertices.add(len(new_verts))
    mesh.vertices.foreach_set("co", new_verts.ravel())
    mesh.loops.add(n_loops)
    mesh.loops.foreach_set("vertex_index", new_faces.ravel())
    mesh.polygons.add(n_polys)
    loop_starts = np.arange(0, n_loops, 3, dtype=np.int32)
    loop_totals = np.full(n_polys, 3, dtype=np.int32)
    mesh.polygons.foreach_set("loop_start", loop_starts)
    mesh.polygons.foreach_set("loop_total", loop_totals)
    mesh.update() 
    mesh.normals_split_custom_set_from_vertices(new_normals)
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj
# -------------------------------------------------------------

def main():
    cleanup_scene()
    
    abs_input = os.path.abspath(INPUT_FILE)
    if not os.path.exists(abs_input):
        print(f"ERRO: Arquivo não encontrado: {abs_input}")
        return

    log(f"Importando geometria original: {INPUT_FILE}...")
    target_obj = import_source_mesh(abs_input)

    bpy.context.view_layer.objects.active = target_obj
    
    # 1. Força Smooth Shading e Aplica Transforms
    bpy.ops.object.shade_smooth()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    
    # 2. LIMPEZA MANUAL DE DADOS (Substitui export_colors=False)
    log("Otimizando malha (removendo cores/atributos)...")
    strip_mesh_data(target_obj)

    if EXPORT_INTERMEDIATE:
        abs_inter = os.path.abspath(INTERMEDIATE_FILE)
        log(f"Salvando intermediário OTIMIZADO: {abs_inter}...")
        
        # 3. Exportação sem o parâmetro problemático
        bpy.ops.export_scene.gltf(
            filepath=abs_inter, 
            export_format='GLB', 
            use_selection=True,
            export_tangents=False,  # Ainda válido e útil para economizar
            export_materials='EXPORT', 
            export_apply=True
        )

    log("Lendo dados para RAM (Numpy)...")
    all_verts, all_faces, all_centers, all_normals = get_mesh_data_numpy(target_obj)
    
    bpy.data.objects.remove(target_obj) # Limpa RAM
    
    log("Calculando Partições...")
    initial_indices = np.arange(len(all_faces), dtype=np.int32)
    final_chunks_indices = recursive_split(initial_indices, all_verts, all_faces, all_centers)
    
    log(f"Gerando {len(final_chunks_indices)} partes...")
    for i, chunk_indices in enumerate(final_chunks_indices):
        obj_name = f"Part_{i:04d}"
        create_mesh_from_indices(obj_name, all_verts, all_normals, all_faces, chunk_indices)
        if i % 20 == 0: print(f"  Chunk {i}...", end='\r')
            
    abs_output = os.path.abspath(OUTPUT_FILE)
    log(f"Exportando Final: {abs_output}...")
    bpy.ops.object.select_all(action='SELECT')
    
    bpy.ops.export_scene.gltf(
        filepath=abs_output, 
        export_format='GLB',
        export_tangents=False
    )
    log("FIM.")

if __name__ == "__main__":
    main()