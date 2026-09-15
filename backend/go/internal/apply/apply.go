package apply

// ExtractionPrefix is where ExtractFn puts corrections.json, tasks.json,
// memories.json and summary.json for one recording, and where ApplyFn looks
// for them. Computed independently on both sides — ExtractFn in Python
// (backend/extract/handler.py's extraction_prefix), ApplyFn here — rather
// than carried on the SQS message, so extractQueue's DLQ (which carries the
// *original* ProcessorFn message, with nothing ExtractFn would have added)
// and applyQueue (ExtractFn's forwarded copy of that same message) need
// exactly one message shape between them.
func ExtractionPrefix(userID, recordingID string) string {
	return "extract/" + userID + "/" + recordingID + "/"
}
