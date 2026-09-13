# Reviewer: correct the rejected reply

Continue in the same session for story #$story_number, still as the
reviewer. The Python driver rejected your reply with this concrete
diagnostic:

$diagnostic

The rules are unchanged: review only, never modify any file, and reply
with the schema fields verdict ("merge" or "fix") and findings (empty
array for "merge"; each finding: file, line, category, required_fix). A
finding must cite a file that is actually in the diff
`git diff origin/main...$branch`.
