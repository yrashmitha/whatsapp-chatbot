import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Pagination from '../components/ui/Pagination';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import ProductModal from '../components/products/ProductModal';
import AttributeModal from '../components/products/AttributeModal';
import ImportModal from '../components/products/ImportModal';
import api from '../lib/api';
import { formatPrice } from '../lib/utils';

export default function Products() {
  const { user } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showProduct, setShowProduct] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [showAttr, setShowAttr] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
    enabled: superAdmin,
  });

  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;
  const params = { page, limit: 30, ...(search && { search }), ...(clientId && { client_id: clientId }) };

  const { data, isLoading } = useQuery({
    queryKey: ['products', params],
    queryFn: () => api.get('/products', { params }).then(r => r.data),
    keepPreviousData: true,
  });

  const { data: attrData } = useQuery({
    queryKey: ['attributes', clientId],
    queryFn: () => api.get('/attributes', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
  });

  const products = data?.products || [];
  const attributes = attrData?.attributes || [];

  const deleteProduct = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`, { params: clientId ? { client_id: clientId } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast.success('Product deleted'); },
    onError: () => toast.error('Failed to delete product'),
  });

  const handleEdit = (p) => { setEditProduct(p); setShowProduct(true); };
  const handleAdd = () => { setEditProduct(null); setShowProduct(true); };

  const refresh = () => qc.invalidateQueries({ queryKey: ['products'] });

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 flex-wrap shrink-0">
          <h1 className="text-lg font-semibold text-slate-800 mr-2">Products</h1>

          {superAdmin && (
            <select value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); setPage(1); }}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400">
              <option value="">All Clients</option>
              {(clientsData?.clients || []).map(c => <option key={c.client_id} value={c.client_id}>{c.client_id}</option>)}
            </select>
          )}

          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search products…" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-violet-400 w-48" />

          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowAttr(true)}>Attributes</Button>
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>Import JSON</Button>
            <Button size="sm" onClick={handleAdd}>+ Add Product</Button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="py-2 text-left pr-4 w-16">Image</th>
                  <th className="py-2 text-left pr-4">Name</th>
                  <th className="py-2 text-left pr-4">Category</th>
                  <th className="py-2 text-left pr-4">Price</th>
                  <th className="py-2 text-left pr-4">Stock</th>
                  {superAdmin && <th className="py-2 text-left pr-4">Client</th>}
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 pr-4">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                        : <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs">—</div>
                      }
                    </td>
                    <td className="py-2 pr-4">
                      <div className="font-medium text-slate-800">{p.name}</div>
                      {p.description && <div className="text-xs text-slate-400 truncate max-w-xs">{p.description}</div>}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{p.category || '—'}</td>
                    <td className="py-2 pr-4 text-slate-700 font-medium">{formatPrice(p.price)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.in_stock ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        {p.in_stock ? 'In Stock' : 'Out'}
                      </span>
                    </td>
                    {superAdmin && <td className="py-2 pr-4 text-violet-500 text-xs">{p.client_id}</td>}
                    <td className="py-2 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleEdit(p)} className="text-xs text-violet-600 hover:text-violet-800 cursor-pointer bg-transparent border-0">Edit</button>
                        <button onClick={() => { if (confirm('Delete this product?')) deleteProduct.mutate(p.id); }}
                          className="text-xs text-red-400 hover:text-red-600 cursor-pointer bg-transparent border-0">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr><td colSpan={superAdmin ? 7 : 6} className="py-12 text-center text-slate-400">No products found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {data?.total > 30 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
            <span className="text-sm text-slate-500">{data.total} total</span>
            <Pagination page={page} total={data.total} limit={30} onChange={setPage} />
          </div>
        )}
      </div>

      <ProductModal open={showProduct} onClose={() => setShowProduct(false)} product={editProduct} attributes={attributes} clientId={clientId} onSaved={refresh} />
      <AttributeModal open={showAttr} onClose={() => setShowAttr(false)} clientId={clientId} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} clientId={clientId} onImported={refresh} />
    </Layout>
  );
}
