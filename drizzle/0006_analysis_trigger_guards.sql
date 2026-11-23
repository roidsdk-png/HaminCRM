DROP TRIGGER IF EXISTS analysis_contacts_update;
--> statement-breakpoint
CREATE TRIGGER analysis_contacts_update
AFTER UPDATE OF name,province,city,gender,age,education,external_user_id,anonymous_id,ip_hash,phone ON contacts
WHEN NEW.name IS NOT OLD.name OR NEW.province IS NOT OLD.province OR NEW.city IS NOT OLD.city OR NEW.gender IS NOT OLD.gender OR NEW.age IS NOT OLD.age OR NEW.education IS NOT OLD.education OR NEW.external_user_id IS NOT OLD.external_user_id OR NEW.anonymous_id IS NOT OLD.anonymous_id OR NEW.ip_hash IS NOT OLD.ip_hash OR NEW.phone IS NOT OLD.phone
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('contact',NEW."id",'update',unixepoch());
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS analysis_sources_update;
--> statement-breakpoint
CREATE TRIGGER analysis_sources_update
AFTER UPDATE OF name,slug,kind,platform,status ON sources
WHEN NEW.name IS NOT OLD.name OR NEW.slug IS NOT OLD.slug OR NEW.kind IS NOT OLD.kind OR NEW.platform IS NOT OLD.platform OR NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO analysis_changes (entity,record_id,operation,created_at)
  VALUES ('source',NEW."id",'update',unixepoch());
END;
