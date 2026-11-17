<script setup lang="ts">
// A4 (D-A4-09) : les inscriptions sont fermées. Message neutre, sans oracle sur l'existence d'un compte : il est
// affiché quand `GET /api/public/etat` annonce `inscriptions: false`. Un seul message à la fois : le parent le masque
// dès qu'une erreur d'envoi de code s'affiche.
</script>

<template>
  <UAlert
    role="alert"
    color="neutral"
    variant="outline"
    icon="i-ph-lock-simple"
    title="Les nouvelles inscriptions sont fermées pour le moment."
    description="Si vous avez déjà une vitrine, connectez-vous."
  />
</template>
