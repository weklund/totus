"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/dashboard/ErrorCard";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";

const profileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be 100 characters or less"),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

/**
 * ProfileForm — display name editing form with validation.
 *
 * Uses React Hook Form + Zod for validation.
 * Loads current profile data and pre-fills the form.
 */
export function ProfileForm() {
  const { data: profileData, isLoading, error, refetch } = useUserProfile();
  const updateProfile = useUpdateProfile();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: "",
    },
  });

  // Update form when profile data loads
  useEffect(() => {
    if (profileData?.data) {
      reset({ display_name: profileData.data.display_name });
    }
  }, [profileData, reset]);

  const onSubmit = (values: ProfileFormValues) => {
    updateProfile.mutate(
      { display_name: values.display_name },
      {
        onSuccess: (response) => {
          toast.success("Profile updated successfully");
          reset({ display_name: response.data.display_name });
        },
        onError: () => {
          toast.error("Failed to update profile. Please try again.");
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="profile-form-loading">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-16" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load profile"
        message={error.message || "Could not load your profile data."}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
      data-testid="profile-form"
    >
      <div className="space-y-2">
        <Label htmlFor="display_name">Display Name</Label>
        <Input
          id="display_name"
          placeholder="Your display name"
          className="max-w-sm"
          {...register("display_name")}
          aria-invalid={!!errors.display_name}
        />
        {errors.display_name && (
          <p className="text-destructive text-sm" role="alert">
            {errors.display_name.message}
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={updateProfile.isPending || !isDirty}
        data-testid="save-profile-button"
      >
        {updateProfile.isPending && (
          <Loader2 className="mr-2 size-4 animate-spin" />
        )}
        Save
      </Button>
    </form>
  );
}
