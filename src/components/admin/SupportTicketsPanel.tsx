import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, MessageSquare, Clock, User, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Ticket {
  id: string;
  user_id: string;
  title: string;
  body: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  last_response_at: string | null;
  created_at: string;
  updated_at: string;
}

const SupportTicketsPanel = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("open");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [responseText, setResponseText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const fetchTickets = async () => {
    setIsLoading(true);
    let query = supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (filterPriority !== 'all') {
      query = query.eq('priority', filterPriority);
    }
    if (filterStatus !== 'all') {
      query = query.eq('status', filterStatus);
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Failed to load tickets");
      console.error(error);
    } else {
      setTickets(data || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchTickets();

    // Realtime subscription
    const channel = supabase
      .channel('admin-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        fetchTickets();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filterPriority, filterStatus]);

  const claimTicket = async (ticketId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('support_tickets')
      .update({ assigned_to: user.id, status: 'in_progress' })
      .eq('id', ticketId);

    if (error) {
      toast.error("Failed to claim ticket");
    } else {
      toast.success("Ticket claimed");
      fetchTickets();
    }
  };

  const handleRespond = async () => {
    if (!selectedTicket || !responseText.trim()) return;
    setIsSending(true);

    // Update ticket with response timestamp and close
    const { error } = await supabase
      .from('support_tickets')
      .update({
        last_response_at: new Date().toISOString(),
        status: 'resolved',
      })
      .eq('id', selectedTicket.id);

    if (error) {
      toast.error("Failed to update ticket");
    } else {
      toast.success("Ticket resolved");
      setSelectedTicket(null);
      setResponseText("");
      fetchTickets();
    }
    setIsSending(false);
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case 'high': return 'destructive';
      case 'normal': return 'secondary';
      case 'low': return 'outline';
      default: return 'secondary';
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'open': return 'destructive';
      case 'in_progress': return 'default';
      case 'resolved': return 'secondary';
      case 'closed': return 'outline';
      default: return 'secondary';
    }
  };

  const isSLABreached = (ticket: Ticket) => {
    if (ticket.last_response_at) return false;
    const age = Date.now() - new Date(ticket.created_at).getTime();
    return age > 24 * 60 * 60 * 1000;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="outline" className="text-muted-foreground">
          {tickets.length} ticket(s)
        </Badge>
      </div>

      {/* Tickets List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No tickets found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card key={ticket.id} className={isSLABreached(ticket) ? 'border-destructive' : ''}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium text-foreground truncate">{ticket.title}</h3>
                      <Badge variant={priorityColor(ticket.priority) as any}>
                        {ticket.priority}
                      </Badge>
                      <Badge variant={statusColor(ticket.status) as any}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                      {isSLABreached(ticket) && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          SLA Breach
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{ticket.body}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {ticket.user_id.slice(0, 8)}
                      </span>
                      {ticket.assigned_to && (
                        <span className="text-primary">Claimed</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!ticket.assigned_to && ticket.status === 'open' && (
                      <Button size="sm" variant="outline" onClick={() => claimTicket(ticket.id)}>
                        Claim
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Respond
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Response Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Respond to Ticket</DialogTitle>
          </DialogHeader>
          {selectedTicket && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-foreground">{selectedTicket.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{selectedTicket.body}</p>
              </div>
              <Textarea
                placeholder="Type your response..."
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                rows={4}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTicket(null)}>Cancel</Button>
            <Button onClick={handleRespond} disabled={isSending || !responseText.trim()}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Resolve & Respond
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupportTicketsPanel;
