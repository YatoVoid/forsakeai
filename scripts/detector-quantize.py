"""Weight-only int8 for the desklib ONNX graph: MatMul weights per output column, embeddings per row. Compute stays fp32."""
import collections, os, sys
import numpy as np, onnx
from onnx import helper, numpy_helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
inits = {i.name: i for i in g.initializer}
consumers = collections.defaultdict(list)
for n in g.node:
    for k, x in enumerate(n.input): consumers[x].append((n, k))

new_nodes, drop = [], set()
for name, init in inits.items():
    if len(init.dims) != 2: continue
    uses = consumers[name]
    w = numpy_helper.to_array(init).astype(np.float32)
    if all(n.op_type in ('MatMul', 'Identity') for n, _ in uses) and w.size >= 1 << 20:
        scale = np.abs(w).max(axis=0) / 127.0
        scale[scale == 0] = 1e-8
        q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
        g.initializer.extend([numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(scale.astype(np.float32), name + '_s'),
                              numpy_helper.from_array(np.zeros(scale.shape, np.int8), name + '_z')])
        new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=1, name=name + '_dq'))
        drop.add(name)
    elif len(uses) == 1 and uses[0][0].op_type == 'Gather' and uses[0][1] == 0 and w.shape[0] > 50000:
        gather = uses[0][0]
        scale = np.abs(w).max(axis=1, keepdims=True) / 127.0
        scale[scale == 0] = 1e-8
        q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
        g.initializer.extend([numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(scale.astype(np.float32), name + '_s')])
        out = gather.output[0]
        gather.input[0] = name + '_q'
        gather.output[0] = out + '_q8'
        new_nodes += [
            helper.make_node('Cast', [out + '_q8'], [out + '_f'], to=TensorProto.FLOAT, name=name + '_cast'),
            helper.make_node('Gather', [name + '_s', gather.input[1]], [out + '_sc'], axis=0, name=name + '_gs'),
            helper.make_node('Mul', [out + '_f', out + '_sc'], [out], name=name + '_mul'),
        ]
        drop.add(name)

keep = [i for i in g.initializer if i.name not in drop]
del g.initializer[:]
g.initializer.extend(keep)
# Dequantize nodes first so every consumer sees its input defined; the embedding ops go right after their Gather.
nodes = list(g.node)
emb = [n for n in new_nodes if n.op_type != 'DequantizeLinear']
dq = [n for n in new_nodes if n.op_type == 'DequantizeLinear']
ordered = dq[:]
for n in nodes:
    ordered.append(n)
    if n.output and n.output[0].endswith('_q8'): ordered += emb
del g.node[:]
g.node.extend(ordered)
print('quantized', len(drop), 'tensors')
os.makedirs(os.path.dirname(dst), exist_ok=True)
onnx.save(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=os.path.basename(dst) + '_data', size_threshold=1024)
onnx.checker.check_model(dst)
