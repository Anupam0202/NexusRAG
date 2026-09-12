from __future__ import annotations
from pathlib import Path
import re,unittest
MIGRATION=Path(__file__).resolve().parents[3]/"supabase"/"migrations"/"023_private_storage_authorization.sql"
class StorageSqlContractTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls)->None:cls.sql=MIGRATION.read_text(encoding="utf-8").lower()
 def test_bucket_is_private_and_bounded(self):self.assertIn("'documents','documents',false,25000000",self.sql);self.assertIn("allowed_mime_types=excluded.allowed_mime_types",self.sql)
 def test_object_write_requires_exact_allocated_key(self):
  fn=self.sql.split("create or replace function nexusrag_private.can_write_document_object",1)[1].split("revoke execute",1)[0]
  for x in ("u.original_key=p_name","u.actor_id=(select auth.uid())","u.state='receiving'","u.write_token is not null","u.expires_at>clock_timestamp()"):self.assertIn(x,fn)
 def test_reads_require_published_active_document_version(self):
  fn=self.sql.split("create or replace function nexusrag_private.can_read_document_object",1)[1].split("create or replace function nexusrag_private.can_write_document_object",1)[0]
  self.assertIn("d.lifecycle_state='active'",fn);self.assertIn("v.publication_state='ready'",fn);self.assertNotIn("v.lifecycle_state",fn)
 def test_client_delete_policy_is_absent_after_legacy_drop(self):
  self.assertIn('drop policy if exists "storage_documents_delete_editors"',self.sql)
  self.assertEqual(re.findall(r'create policy\s+"[^"]+"\s+on storage\.objects for (\w+)',self.sql),["select","insert","update"])
 def test_private_helpers_are_fixed_path_security_definer(self):
  self.assertGreaterEqual(self.sql.count("security definer"),2);self.assertGreaterEqual(self.sql.count("set search_path=public,storage,pg_temp"),2);self.assertIn("revoke execute on function nexusrag_private.can_write_document_object(text) from public,anon",self.sql)
 def test_cleanup_claim_is_service_only_bounded_and_skip_locked(self):
  for x in ("p_limit not between 1 and 500","for update skip locked","revoke execute on function public.claim_expired_document_uploads(integer) from public,anon,authenticated","cleanup_state='pending'"):self.assertIn(x,self.sql)
if __name__=="__main__":unittest.main()
