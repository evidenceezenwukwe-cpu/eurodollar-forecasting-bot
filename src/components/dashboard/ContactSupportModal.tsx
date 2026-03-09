import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, LifeBuoy } from "lucide-react";

interface ContactSupportModalProps {
  userEmail?: string;
  planType?: string;
}

export const ContactSupportModal = ({ userEmail, planType }: ContactSupportModalProps) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFunded = planType === 'funded' || planType === 'lifetime';

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in first");
        return;
      }

      const response = await supabase.functions.invoke('create-support-ticket', {
        body: { title, body, priority },
      });

      if (response.error) throw response.error;

      toast.success("Support ticket created! We'll get back to you soon.");
      setTitle("");
      setBody("");
      setPriority("normal");
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create ticket");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LifeBuoy className="h-4 w-4" />
          Support
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            Contact Support
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isFunded && (
            <div className="text-xs text-primary bg-primary/10 rounded-md px-3 py-2">
              ⚡ Priority support — your ticket will be escalated automatically
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ticket-title">Subject</Label>
            <Input
              id="ticket-title"
              placeholder="Brief description of your issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-body">Details</Label>
            <Textarea
              id="ticket-body"
              placeholder="Describe your issue in detail..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Submit Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
