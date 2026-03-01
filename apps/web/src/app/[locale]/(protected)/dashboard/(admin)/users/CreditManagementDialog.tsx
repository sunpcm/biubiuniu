// [CUSTOM: START] - Admin credit management dialog
"use client";

import { adjustUserCredits, getUserCredits } from "@/actions/custom/credits";
import { Button } from "@niu/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@niu/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@niu/ui/form";
import { Input } from "@niu/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@niu/ui/select";
import { Textarea } from "@niu/ui/textarea";
import { UserType } from "@/types/admin/users";
import { zodResolver } from "@hookform/resolvers/zod";
import { Coins, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  operation: z.enum(["add", "set", "deduct"]),
  oneTimeCredits: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }, "Must be a valid non-negative number"),
  subscriptionCredits: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }, "Must be a valid non-negative number"),
  notes: z.string().min(1, "Notes are required"),
});

type FormValues = z.infer<typeof formSchema>;

interface CreditManagementDialogProps {
  user: UserType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreditManagementDialog({ user, open, onOpenChange }: CreditManagementDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [currentCredits, setCurrentCredits] = useState<{
    oneTime: number;
    subscription: number;
    total: number;
  }>({ oneTime: 0, subscription: 0, total: 0 });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      operation: "add",
      oneTimeCredits: "0",
      subscriptionCredits: "0",
      notes: "",
    },
  });

  useEffect(() => {
    if (open && user) {
      fetchUserCredits();
      form.reset({
        operation: "add",
        oneTimeCredits: "0",
        subscriptionCredits: "0",
        notes: "",
      });
    }
  }, [open, user]);

  const fetchUserCredits = async () => {
    if (!user) return;

    setLoadingCredits(true);
    try {
      const result = await getUserCredits(user.id);
      if (result.success && result.data) {
        setCurrentCredits({
          oneTime: result.data.oneTimeCreditsBalance,
          subscription: result.data.subscriptionCreditsBalance,
          total: result.data.totalCredits,
        });
      } else {
        toast.error(result.error || "Failed to load user credits");
      }
    } catch (_error) {
      toast.error("Failed to load user credits");
    } finally {
      setLoadingCredits(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user) return;

    const oneTimeCredits = parseFloat(values.oneTimeCredits);
    const subscriptionCredits = parseFloat(values.subscriptionCredits);

    if (oneTimeCredits === 0 && subscriptionCredits === 0) {
      toast.error("Please specify at least one credit amount");
      return;
    }

    setLoading(true);
    try {
      const result = await adjustUserCredits({
        userId: user.id,
        oneTimeCredits,
        subscriptionCredits,
        operation: values.operation,
        notes: values.notes,
      });

      if (result.success) {
        toast.success("Credits adjusted successfully");
        onOpenChange(false);
        // 刷新积分信息
        await fetchUserCredits();
      } else {
        toast.error(result.error || "Failed to adjust credits");
      }
    } catch (_error) {
      toast.error("An error occurred while adjusting credits");
    } finally {
      setLoading(false);
    }
  };

  const getOperationDescription = (operation: string) => {
    switch (operation) {
      case "add":
        return "Add credits to current balance";
      case "set":
        return "Set credits to specific amount";
      case "deduct":
        return "Deduct credits from current balance";
      default:
        return "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Manage Credits - {user?.email}
          </DialogTitle>
          <DialogDescription>
            Adjust user credit balance. All changes will be logged for audit purposes.
          </DialogDescription>
        </DialogHeader>

        {loadingCredits ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Current Credits Display */}
            <div className="bg-muted grid grid-cols-3 gap-4 rounded-lg p-4">
              <div className="text-center">
                <div className="text-muted-foreground text-sm">One-time</div>
                <div className="font-semibold">{currentCredits.oneTime}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground text-sm">Subscription</div>
                <div className="font-semibold">{currentCredits.subscription}</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground text-sm">Total</div>
                <div className="text-primary font-semibold">{currentCredits.total}</div>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="operation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Operation</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select operation" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="add">Add Credits</SelectItem>
                          <SelectItem value="set">Set Credits</SelectItem>
                          <SelectItem value="deduct">Deduct Credits</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-muted-foreground text-xs">
                        {getOperationDescription(field.value)}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="oneTimeCredits"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>One-time Credits</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min="0" step="1" placeholder="0" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="subscriptionCredits"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subscription Credits</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min="0" step="1" placeholder="0" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes *</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Reason for credit adjustment (required for audit)"
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply Changes
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
// [CUSTOM: END]
